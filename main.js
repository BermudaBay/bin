import { homedir } from "node:os"
import { join as pathJoin, dirname } from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { exit } from "node:process"
import { formatUnits, parseUnits, Wallet } from "ethers"
import { blake2s } from "@noble/hashes/blake2.js"
import bermuda from "@bermuda/sdk"
import pkg from "./package.json" with { type: "json" }

const HELP = `
  ██████╗ ███████╗██████╗ ███╗   ███╗██╗   ██╗██████╗  █████╗
  ██╔══██╗██╔════╝██╔══██╗████╗ ████║██║   ██║██╔══██╗██╔══██╗
  ██████╔╝█████╗  ██████╔╝██╔████╔██║██║   ██║██║  ██║███████║
  ██╔══██╗██╔══╝  ██╔══██╗██║╚██╔╝██║██║   ██║██║  ██║██╔══██║
  ██████╔╝███████╗██║  ██║██║ ╚═╝ ██║╚██████╔╝██████╔╝██║  ██║
  ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝
  bermuda v${pkg.version}

commands:
  keygen          Generates a Bermuda key pair
  address         Display your Bermuda address
  balance         Display your shielded assets
  deposit         Deposit into Bermuda
  transfer        Transfer within Bermuda
  withdraw        Withdraw from Bermuda

flags:
  --chain         testenv or base-sepolia; default: base-sepolia
  --rpc           Custom RPC; default: https://base-sepolia-rpc.publicnode.com
  --profile       Resolves a specific Bermuda account config; default: default
  --seed          Keygen seed, fx a password or private key
  --private-key   Private key of funding account in case of deposits
  --to            Recipient address or alias; deposit-default: self
  --token         Symbol of the token to transact: (W)ETH, USDC, USDT; supports
                  custom tokens from ~/.bermudabay/bin/$profile/tokenlist.json
  --amount        Amount to transact in the main unit
  --relayer-fee   Relayer fee for transfers and withdrawals; default: 0
  --unwrap        Unwrap WETH to ETH when withdrawing; default: false
  -h, --help      Display this help
  -v, --version   Display the binary version

examples:
  # writes key to ~/.bermudabay/bin/default/bermudakey.hex
  bermuda keygen --seed myseed
  # core ops
  bermuda deposit --token eth --amount 0.9 --private-key 0x...
  bermuda transfer --to 0x... --token weth --amount 0.3
  bermuda withdraw --to 0x... --token weth --amount 0.3 --unwrap
  # recipient batching available for deposits and transfers
  bermuda transfer --token weth 0x... 0.1 0x... 0.2 0x... 0.3

config:
  ~/.bermudabay/bin/$profile/tokenlist.json [{chainId,address,symbol,decimals}]
  ~/.bermudabay/bin/$profile/addresses.json [{alias,address}]`

main()

async function main() {
  let { values: opts, positionals: args } = parseArgs({
    args: process.argv,
    options: {
      seed: { type: "string" },
      profile: { type: "string" },
      chain: { type: "string" },
      "private-key": { type: "string" },
      to: { type: "string" },
      token: { type: "string" },
      amount: { type: "string" },
      "relayer-fee": { type: "string" },
      unwrap: { type: "boolean" },
      help: { type: "boolean" },
      h: { type: "boolean" },
      version: { type: "boolean" },
      v: { type: "boolean" }
    },
    strict: false,
    allowPositionals: true
  })

  if (opts.help || opts.h) return console.log(HELP)
  if (opts.version || opts.v) return console.log(`bermuda ${pkg.version}`)

  opts = {
    ...opts,
    chain: opts.chain || process.env.BERMUDA_CHAIN || "base-sepolia",
    profile: opts.profile || process.env.BERMUDA_PROFILE || "default",
    seed: opts.seed || process.env.BERMUDA_SEED,
    ["private-key"]: opts["private-key"] || process.env.PRIVATE_KEY
  }

  const sdkOpts = {
    utxoCache: utxopath(opts.profile),
    commitmentEventsCache: commitmenteventspath(opts.profile)
  }

  if (opts.rpc || process.env.RPC || process.env.RPC_URL) {
    sdkOpts.provider = opts.rpc || process.env.RPC || process.env.RPC_URL
  }

  const sdk = bermuda(opts.chain, sdkOpts)
  await sdk._.initBbSync() //FIXME

  switch (args[2]) {
    case "keygen":
      await keygen(opts, sdk)
      break
    case "address":
      await address(opts, sdk)
      break
    case "balance":
      await balance(opts, sdk)
      break
    case "deposit":
      await deposit(opts, args, sdk)
      break
    case "transfer":
      await transfer(opts, args, sdk)
      break
    case "withdraw":
      await withdraw(opts, sdk)
      break
    default:
      console.log(HELP)
  }

  exit(0)
}

async function keygen(opts, sdk) {
  const bayKeyFile = keypath(opts.profile)
  const bayKey = await readFile(bayKeyFile, { encoding: "utf8" }).catch(noop)
  if (bayKey)
    return console.warn(opts.profile, "key already exists - skipping keygen")

  const bermudaKeyPair = _keygen(opts.seed, sdk)
  await mkdir(dirname(bayKeyFile), { recursive: true })
  await writeFile(bayKeyFile, sdk.hex(bermudaKeyPair.privkey, 32))

  console.log(bermudaKeyPair.address())
}

async function address(opts, sdk) {
  const adrs = await keypair(opts, sdk).then(kp => kp.address())
  console.log(adrs)
}

async function balance(opts, sdk) {
  const utxosByTokens = await sdk.findUtxos({
    keypair: await keypair(opts, sdk),
    tokens: await tokenlist(opts, sdk)
  })

  for (let tokenAdrs in utxosByTokens) {
    const info = await tokeninfo(tokenAdrs, opts, sdk)
    const total = sdk.sumAmounts(utxosByTokens[tokenAdrs])
    const pretty = formatUnits(total, info.decimals)
    console.log(`${info.symbol} ${pretty}`)
  }
}

async function deposit(opts, args, sdk) {
  if (
    !opts["private-key"] ||
    ((!opts.token || !opts.amount) &&
      !opts.token &&
      !args.slice(2, 4).every(Boolean))
  )
    return console.log(HELP)

  const token = await tokeninfo(opts.token, opts, sdk).then(
    info => info.address
  )
  const decimals =
    opts.token.toLowerCase() === "usdc" ? 6 : 18

  let total = 0n
  let recipients = []
  if (opts.token && !opts.amount) {
    // batch case: --token <token> <to0> <amount0> <to1> <amount1> ...
    const _args = args.slice(2)
    for (let i = 0; i < _args.length - 1; i++) {
      const shieldedAddress = await unalias(_args[i], "bermuda", opts)
      const amount = parseUnits(_args[i + 1], decimals)
      recipients.push({ to: shieldedAddress, amount })
      total += amount
    }
  } else {
    let shieldedAddress = await unalias(opts.to, "bermuda", opts)
    if (!shieldedAddress) {
      shieldedAddress = await keypair(opts, sdk).then(kp => kp.address())
    }
    const amount = parseUnits(opts.amount, decimals)
    recipients.push({ to: shieldedAddress, amount })
    total = amount
  }

  const wallet = new Wallet(opts["private-key"], sdk.config.provider)

  const payload = await sdk.deposit(
    {
      signer: wallet,
      token,
      recipients,
      wrap: opts.token.toLowerCase() === "eth"
    }
  )

  await wallet
    .sendTransaction({
      ...payload,
      value: opts.token.toLowerCase() === "eth" ? total : 0n,
      gasLimit: 7_000_000
    })
    .then(res => console.log(res.hash))
}

async function transfer(opts, args, sdk) {
  if (
    (!opts.to || !opts.token || !opts.amount) &&
    !opts.token &&
    !args.slice(2, 4).every(Boolean)
  )
    return console.log(HELP)

  const token = await tokeninfo(opts.token, opts, sdk).then(
    info => info.address
  )
  const decimals =
    opts.token.toLowerCase() === "usdc" ? 6 : 18

  let recipients = []
  if (opts.token && !opts.amount) {
    // batch case: --token <token> <to0> <amount0> <to1> <amount1> ...
    const _args = args.slice(2)
    for (let i = 0; i < _args.length - 1; i++) {
      const shieldedAddress = await unalias(_args[i], "bermuda", opts)
      const amount = parseUnits(_args[i + 1], decimals)
      recipients.push({ to: shieldedAddress, amount })
    }
  } else {
    let shieldedAddress = await unalias(opts.to, "bermuda", opts)
    if (!shieldedAddress) {
      shieldedAddress = await keypair(opts, sdk).then(kp => kp.address())
    }
    const amount = parseUnits(opts.amount, decimals)
    recipients.push({ to: shieldedAddress, amount })
  }

  const senderKeyPair = await keypair(opts, sdk)
  const fee = opts["relayer-fee"]
    ? parseUnits(opts["relayer-fee"], decimals)
    : 0n

  const transferParams = {
    token,
    spender: senderKeyPair,
    recipients
  }
  const transferOptions = {
    fee
  }

  const transferPlan = await sdk.previewTransferPlan(transferParams, transferOptions)
  const transferTxHashes = await sdk.executeTransferPlan(
    transferParams,
    transferPlan,
    transferOptions
  )

  console.log(transferTxHashes.join('\n'))
}

async function withdraw(opts, sdk) {
  if (!opts.to || !opts.token || !opts.amount) return console.log(HELP)

  const bermudaKeyPair = await keypair(opts, sdk)
  const token = await tokeninfo(opts.token, opts, sdk).then(
    info => info.address
  )
  const decimals =
    opts.token.toLowerCase() === "usdc" ? 6 : 18
  const fee = opts["relayer-fee"]
    ? parseUnits(opts["relayer-fee"], decimals)
    : 0n
  const amount = parseUnits(opts.amount, decimals)
  const recipient = await unalias(opts.to, "ethereum", opts)

  const withdrawParams = {
    token,
    amount,
    spender: bermudaKeyPair,
    to: recipient
  }
  const withdrawOptions = {
    fee,
  }

  const withdrawPlan = await sdk.previewWithdrawPlan(
    withdrawParams,
    withdrawOptions
  )
  const withdrawTxHashes = await sdk.executeWithdrawPlan(
    withdrawParams,
    withdrawPlan,
    withdrawOptions
  )

  console.log(withdrawTxHashes.join('\n'))
}

const FIELD_SIZE =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n

function _keygen(seed, sdk) {
  return sdk.KeyPair.fromScalar(
    BigInt(sdk.hex(blake2s(new TextEncoder().encode(seed)))) % FIELD_SIZE
  )
}

async function keypair(opts, sdk) {
  const bayKeyFile = keypath(opts.profile)
  const bayKey = await readFile(bayKeyFile, { encoding: "utf8" }).catch(noop)
  if (!bayKey) throw Error("no bermuda key")
  return sdk.KeyPair.fromScalar(BigInt(bayKey))
}

function keypath(profile = "default") {
  return pathJoin(homedir(), ".bermudabay", "bin", profile, "bermudakey.hex")
}

function adrsbookpath(profile = "default") {
  return pathJoin(homedir(), ".bermudabay", "bin", profile, "addresses.json")
}

function utxopath(profile = "default") {
  return pathJoin(homedir(), ".bermudabay", "bin", profile, "utxocache.json")
}

function commitmenteventspath(profile = "default") {
  return pathJoin(homedir(), ".bermudabay", "bin", profile, "commitmenteventscache.json")
}

function tokenlistpath(profile = "default") {
  return pathJoin(homedir(), ".bermudabay", "bin", profile, "tokenlist.json")
}

async function tokenlist(opts, sdk) {
  let tokens = []
  const rawTokenList = await readFile(tokenlistpath(opts.profile), {
    encoding: "utf8"
  }).catch(noop)
  if (rawTokenList) {
    const tokenList = JSON.parse(rawTokenList)
      .filter(t => BigInt(t.chainId) === sdk.config.chainId)
      .map(t => t.address.toLowerCase())
    tokens.push(...tokenList)
  }
  for (const adrs of [sdk.config.WETH, sdk.config.USDC].map(adrs =>
    adrs.toLowerCase()
  )) {
    if (!tokens.includes(adrs)) tokens.push(adrs)
  }
  return tokens
}

async function tokeninfo(x, opts, sdk) {
  const rawTokenList = await readFile(tokenlistpath(opts.profile), {
    encoding: "utf8"
  }).catch(noop)
  if (rawTokenList) {
    const tokenList = JSON.parse(rawTokenList)
    for (const entry of tokenList) {
      if (
        BigInt(entry.chainId) === sdk.config.chainId &&
        (entry.symbol.toLowerCase() === x.toLowerCase() ||
          entry.address.toLowerCase() === x.toLowerCase())
      ) {
        return entry
      }
    }
  }
  switch (x.toLowerCase()) {
    case "eth":
    case "weth":
    case sdk.config.WETH.toLowerCase():
      return { symbol: "WETH", address: sdk.config.WETH, decimals: 18 }
    case "usdc":
    case sdk.config.USDC.toLowerCase():
      return { symbol: "USDC", address: sdk.config.USDC, decimals: 6 }
    default:
      throw Error("unknown token")
  }
}

async function unalias(x, type, opts) {
  if (/^0x[a-fA-F0-9]{40}$/.test(x)) {
    if (type === "ethereum") return x
  }
  if (x?.endsWith(".eth")) {
    const ea = await getDefaultProvider("mainnet").resolveName(x)
    if (type === "ethereum") return ea
  }
  if (x && !/^0x[a-fA-F0-9]{128}$/.test(x)) {
    const book = await readFile(adrsbookpath(opts.profile), {
      encoding: "utf8"
    }).catch(noop)
    if (!book) throw Error("no address book")
    const entry = JSON.parse(book).find(entry => entry.alias === x)
    if (!entry) throw Error("no address found for given alias")
    return entry.address
  }
  return x
}

function noop() {}
