import { homedir } from "node:os"
import { join as pathJoin, dirname } from "node:path"
import { mkdir } from "node:fs/promises"
import { parseArgs } from "node:util"
import { exit } from "node:process"
import { formatUnits, parseUnits, Wallet } from "ethers"
import { blake2s } from "@noble/hashes/blake2.js"
import bermuda from "@bermuda/sdk"
import pkg from "./package.json" with { type: "json" }

const HELP = `bermuda ${pkg.version}

commands:
  keygen          Generates a Bermuda key pair
  address         Display your Bermuda address
  balance         Display your shielded assets
  deposit         Deposit into Bermuda
  transfer        Transfer within Bermuda
  withdraw        Withdraw from Bermuda

flags:
  --chain         testenv or base-sepolia (default)
  --seed          Keygen seed, fx a password or private key
  --profile       Profiles allow separating various owned keys
  --private-key   Private key of funding account in case of deposits
  --to            Recipient Bermuda or Ethereum address
  --token         Token to transact: ETH, WETH, USDC
  --amount        Amount to transact
  --relayer-fee   Relayer fee for transfers and withdrawals
  --unwrap        Unwrap WETH to ETH when withdrawing

examples:
  bermuda keygen --seed myseed
  bermuda deposit --token eth --amount 0.9 --private-key 0x...
  bermuda transfer --to 0x... --token weth --amount 0.3
  bermuda withdraw --to 0x... --token weth --amount 0.3 --unwrap
`

main()

async function main() {
  let { values: opts, positionals: args } = parseArgs({
    args: Bun.argv,
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
      help: { type: "string" }
    },
    strict: false,
    allowPositionals: true
  })

  if (opts.help) return console.log(HELP)

  opts = {
    ...opts,
    chain: opts.chain || process.env.BERMUDA_CHAIN || "base-sepolia",
    profile: opts.profile || process.env.BERMUDA_PROFILE || "default",
    seed: opts.seed || process.env.BERMUDA_SEED,
    ["private-key"]: opts["private-key"] || process.env.PRIVATE_KEY
  }

  switch (args[2]) {
    case "keygen":
      await keygen(opts)
      break
    case "address":
      await address(opts)
      break
    case "balance":
      await balance(opts)
      break
    case "deposit":
      await deposit(opts)
      break
    case "transfer":
      await transfer(opts)
      break
    case "withdraw":
      await withdraw(opts)
      break
    default:
      console.log(HELP)
  }

  exit(0)
}

async function keygen(opts: any) {
  const sdk = bermuda(opts.chain)
  const bayKeyFile = keypath(opts.profile)
  const bayKey = await readFile(bayKeyFile).catch(noop)
  if (bayKey) return console.warn(opts.profile, "key already exists - skipping keygen")

  const bermudaKeyPair = generateKeyPair(opts.seed, sdk)
  await mkdir(dirname(bayKeyFile), { recursive: true })
  await Bun.file(bayKeyFile).write(sdk.hex(bermudaKeyPair.privkey, 32))

  console.log(bermudaKeyPair.address())
}

async function address(opts: any) {
  const sdk = bermuda(opts.chain)
  const bermudaKeyPair = await getKeyPair(opts, sdk)
  console.log(bermudaKeyPair.address())
}

async function balance(opts: any) {
  const sdk = bermuda(opts.chain)
  const bermudaKeyPair = await getKeyPair(opts, sdk)
  //LATER read from tokenlist config file
  const tokens = [sdk.config.mockWETH!, sdk.config.mockUSDC!].map(t => t.toLowerCase())
  const utxosByTokens = await sdk.findUtxos({
    keypair: bermudaKeyPair,
    tokens
  })

  for (let tokenAdrs in utxosByTokens) {
    const symbol =
      tokenAdrs === sdk.config.mockWETH?.toLowerCase()
        ? "WETH"
        : tokenAdrs === sdk.config.mockUSDC?.toLowerCase()
          ? "USDC"
          : null
    const total = sdk.sumAmounts(utxosByTokens[tokenAdrs])
    const pretty = formatUnits(total, tokenAdrs === sdk.config.mockUSDC?.toLowerCase() ? 6 : 18)
    console.log(`${symbol} ${pretty}`)
  }
}

async function deposit(opts: any) {
  //LATER passthru batch info as: --token <token> <to0> <amount0> <to1> <amount1> ...
  // || (!opts.token && !args.slice(0, 2).every(Boolean))
  if (!opts["private-key"] || !opts.token || !opts.amount) {
    return console.log(HELP)
  }

  const sdk = bermuda(opts.chain)

  let to = await unalias(opts.to, opts)
  if (!to) {
    const bermudaKeyPair = await getKeyPair(opts, sdk)
    to = await bermudaKeyPair.address()
  }

  const token = tokenadrs(opts.token, sdk)
  const decimals = opts.token.toLowerCase() === sdk.config.mockUSDC?.toLowerCase() ? 6 : 18
  const amount = parseUnits(opts.amount, decimals)
  const wallet = new Wallet(opts["private-key"], sdk.config.provider)
  let permit

  if (opts.token.toLowerCase() !== "eth") {
    permit = await sdk.permit({
      signer: wallet,
      spender: await sdk.config.pool.getAddress(),
      token,
      amount,
      deadline: await sdk.config.provider.getBlock("latest").then(b => BigInt(b!.timestamp + 100))
    })
  }

  const payload = await sdk.deposit(
    {
      token,
      recipients: [{ amount: amount, shieldedAddress: to }]
    },
    { fundingAccount: wallet.address, permit }
  )

  await wallet
    .sendTransaction({ ...payload, value: opts.token.toLowerCase() === "eth" ? amount : 0n })
    .then(res => console.log(res.hash))
}

async function transfer(opts: any) {
  //LATER passthru batch info as: --token <token> <to0> <amount0> <to1> <amount1> ...
  // || (!opts.token && !args.slice(0, 2).every(Boolean))
  if (!opts.to || !opts.token || !opts.amount) {
    return console.log(HELP)
  }

  const sdk = bermuda(opts.chain)
  const senderKeyPair = await getKeyPair(opts, sdk)
  const token = tokenadrs(opts.token, sdk)
  const decimals = opts.token.toLowerCase() === sdk.config.mockUSDC?.toLowerCase() ? 6 : 18
  const fee = opts["relayer-fee"] ? parseUnits(opts["relayer-fee"], decimals) : 0n
  const amount = parseUnits(opts.amount, decimals)
  const shieldedAddress = await unalias(opts.to, opts)

  const payload = await sdk.transfer(
    {
      senderKeyPair,
      token,
      recipients: [{ amount, shieldedAddress }]
    },
    { fee }
  )

  await sdk.relay(sdk.config.relayer!, payload).then(console.log)
}

async function withdraw(opts: any) {
  if (!opts.to || !opts.token || !opts.amount) {
    return console.log(HELP)
  }

  const sdk = bermuda(opts.chain)
  const bermudaKeyPair = await getKeyPair(opts, sdk)
  const token = tokenadrs(opts.token, sdk)
  const decimals = opts.token.toLowerCase() === sdk.config.mockUSDC?.toLowerCase() ? 6 : 18
  const fee = opts["relayer-fee"] ? parseUnits(opts["relayer-fee"], decimals) : 0n
  const amount = parseUnits(opts.amount, decimals)
  const recipient = await unalias(opts.to, opts)

  const payload = await sdk.withdraw(
    {
      senderKeyPair: bermudaKeyPair,
      token,
      amount,
      recipient
    },
    { fee, unwrap: opts.unwrap }
  )

  await sdk.relay(sdk.config.relayer!, payload).then(console.log)
}

const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

function generateKeyPair(seed: string, sdk: any) {
  return sdk.KeyPair.fromScalar(
    BigInt(sdk.hex(blake2s(new TextEncoder().encode(seed)))) % FIELD_SIZE
  )
}

async function getKeyPair(opts: any, sdk: any) {
  const bayKeyFile = keypath(opts.profile)
  const bayKey = await readFile(bayKeyFile).catch(noop)
  if (!bayKey) throw Error("no bermuda key")
  return sdk.KeyPair.fromScalar(BigInt(bayKey))
}

function keypath(profile: string = "default"): string {
  return pathJoin(homedir(), ".bermudabay", "cli", profile, "bay_key")
}

function bookpath(profile: string = "default"): string {
  return pathJoin(homedir(), ".bermudabay", "cli", profile, "adrs_book")
}

function tokenadrs(x: string, sdk: any): string {
  if (x.toLowerCase() === "eth") {
    return sdk.config.mockWETH
  } else if (x.toLowerCase() === "weth") {
    return sdk.config.mockWETH
  } else if (x.toLowerCase() === "usdc") {
    return sdk.config.mockUSDC
  } else {
    return x
  }
}

async function unalias(x: string, opts: any): Promise<string> {
  //LATER also resolve aliases thru the bermuda registry
  if (x && !/^0x[a-fA-F0-9]{128}$/.test(x)) {
    const book = await readFile(bookpath(opts.profile)).catch(noop)
    if (!book) throw Error("no address book")
    const entry = JSON.parse(book).find(entry => entry.alias === x)
    if (!entry) throw Error("no address found for alias")
    return entry.address
  }
  return x
}

async function readFile(filepath: string): Promise<string | undefined> {
  return Bun.file(filepath)
    .text()
    .then(s => s?.trim())
}

function noop() {}
