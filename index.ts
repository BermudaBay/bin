// CLI interface

///must login first
///set --profile to load given profile state
///set --password used for file encryption and shkp seeding
///wip --snap $origin connect to our shkp-snap
// login --profile ... --password ... ~~snap~~

///sets aliases for addresses
// adrsbook ?$alias ?$sa

///lists available token symbol,adrs
// tokens

// address
// balance

///these send the payloads through our relayer
// deposit(...TODO)
// transfer(...TODO)
// withdraw(...TODO)

/////

import { homedir } from "node:os"
import { join as pathJoin, dirname } from "node:path"
import { mkdir } from "node:fs/promises"
import { parseArgs } from "node:util"
import { privateEncrypt, privateDecrypt } from "node:crypto"
import { formatUnits, parseUnits, Wallet } from "ethers"
import { blake2s } from "@noble/hashes/blake2.js"
import bermuda, { type ISdk } from "@bermuda/sdk"

let sdk: ISdk
let password: string
let bermudaKeyPair: any

async function main() {
  const { values: opts, positionals: args } = parseArgs({
    args: Bun.argv,
    options: {
      password: { type: "string" },
      profile: { type: "string" }, // default or saved profile
      chain: { type: "string" }, // optionally testenv, base-sepolia by default
      "private-key": { type: "string" },
      to: { type: "string" },
      token: { type: "string" },
      value: { type: "string" },
      "relayer-fee": { type: "string" }
    },
    allowPositionals: true 
  })

  switch (args[0]) {
    case 'login': await login(opts); break
    case 'adrs': 
    case 'adrsbook':
    case 'tokens':
    case 'balance':
    case 'deposit':
    case 'transfer':
    case 'withdraw':
    default: console.log("HELP")
  }
}

async function login(opts: any) {
  // const { values: opts } = parseArgs({
  //   args: Bun.argv,
  //   options: {
  //     password: { type: "string" },
  //     profile: { type: "string" }, // default or saved profile
  //     snap: { type: "boolean" },
  //     chain: { type: "string" } // optionally testenv, base-sepolia by default
  //   }
  // })

  sdk = bermuda(opts.chain || "base-sepolia")
  password = opts.password || (await prompt("password: "))

  const bayKeyFile = keypath(opts.profile)
  const bayKey = await readEncryptedFile(bayKeyFile, password).catch(noop)

  if (!bayKey) {
    bermudaKeyPair = keygen(password)

    await mkdir(dirname(bayKeyFile), { recursive: true })
    await writeEncryptedFile(sdk.hex(bermudaKeyPair.privkey, 32), bayKeyFile, password)
  } else {
    bermudaKeyPair = sdk.KeyPair.fromScalar(BigInt(bayKey))
  }
}

async function addressBook(opts: any, args:any) {
  if (!password) return console.log("HELP")

  // const { positionals: args } = parseArgs({ args: Bun.argv, allowPositionals: true })
  const [_cmd, alias, shieldedAddress] = args

  const bookPath = adrsBookPath(opts.profile)
  const book = await readEncryptedFile(bookPath, password).then(book => JSON.parse(book!))

  if (!alias || !shieldedAddress) {
    console.log(book)
  } else {
    book[alias] = shieldedAddress

    await Bun.file(bookPath).write(JSON.stringify(book, null, 2))
  }
}

async function address() {
  if (!bermudaKeyPair) return console.log("HELP")

  console.log(await bermudaKeyPair.address())
}

//LATER allow customization of tokenlist through env var or somehow
function tokens() {
  console.log(`WETH ${sdk.config.mockWETH}\nUSDC ${sdk.config.mockUSDC}`)
}

function _tokens() {
  return [sdk.config.mockWETH!, sdk.config.mockUSDC!].map(t => t.toLowerCase())
}

async function balance() {
  if (!bermudaKeyPair) return console.log("HELP")

  const tokens = _tokens()
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
  // const { values: opts, positionals: args } = parseArgs({
  //   args: Bun.argv,
  //   options: {
  //     "private-key": { type: "string" },
  //     to: { type: "string" },
  //     token: { type: "string" },
  //     value: { type: "string" },
  //     "relayer-fee": { type: "string" }
  //   },
  //   allowPositionals: true
  // })

  //LATER passthru batch info as: --token <token> <to0> <amount0> <to1> <amount1> ...
  // || (!opts.token && !args.slice(0, 2).every(Boolean))
  if (!opts["private-key"] || !opts.to || !opts.token || !opts.value) {
    return console.log("HELP")
  }

  const decimals = opts.token.toLowerCase() === sdk.config.mockUSDC?.toLowerCase() ? 6 : 18
  const fee = opts["relayer-fee"] ? parseUnits(opts["relayer-fee"], decimals) : 0n
  const amount = parseUnits(opts.value, decimals)

  const wallet = new Wallet(opts["private-key"])

  const permit = await sdk.permit({
    signer: wallet,
    spender: await sdk.config.pool.getAddress(),
    token: opts.token,
    amount: amount + fee,
    deadline: await sdk.config.provider.getBlock("latest").then(b => BigInt(b!.timestamp + 100))
  })

  const payload = await sdk.deposit(
    {
      token: opts.token,
      recipients: [{ amount: amount, shieldedAddress: opts.to }]
    },
    { fee, fundingAccount: wallet.address, permit }
  )

  await sdk.relay(sdk.config.relayer!, payload)
}

async function transfer(opts: any) {
  // const { values: opts } = parseArgs({
  //   args: Bun.argv,
  //   options: {
  //     to: { type: "string" },
  //     token: { type: "string" },
  //     value: { type: "string" },
  //     "relayer-fee": { type: "string" }
  //   }
  // })

  //LATER passthru batch info as: --token <token> <to0> <amount0> <to1> <amount1> ...
  // || (!opts.token && !args.slice(0, 2).every(Boolean))
  if (!opts.to || !opts.token || !opts.value) {
    return console.log("HELP")
  }

  const decimals = opts.token.toLowerCase() === sdk.config.mockUSDC?.toLowerCase() ? 6 : 18
  const fee = opts["relayer-fee"] ? parseUnits(opts["relayer-fee"], decimals) : 0n
  const amount = parseUnits(opts.value, decimals)

  const payload = await sdk.transfer(
    {
      senderKeyPair: bermudaKeyPair,
      token: opts.token,
      recipients: [{ amount: amount, shieldedAddress: opts.to }]
    },
    { fee }
  )

  await sdk.relay(sdk.config.relayer!, payload)
}

async function withdraw(opts: any) {
  // const { values: opts } = parseArgs({
  //   args: Bun.argv,
  //   options: {
  //     to: { type: "string" },
  //     token: { type: "string" },
  //     value: { type: "string" },
  //     "relayer-fee": { type: "string" }
  //   }
  // })

  if (!opts.to || !opts.token || !opts.value) {
    return console.log("HELP")
  }

  const decimals = opts.token.toLowerCase() === sdk.config.mockUSDC?.toLowerCase() ? 6 : 18
  const fee = opts["relayer-fee"] ? parseUnits(opts["relayer-fee"], decimals) : 0n
  const amount = parseUnits(opts.value, decimals)

  const payload = await sdk.withdraw(
    {
      senderKeyPair: bermudaKeyPair,
      token: opts.token,
      amount,
      recipient: opts.to
    },
    { fee }
  )

  await sdk.relay(sdk.config.relayer!, payload)
}

const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function keygen(password: string) {
  return sdk.KeyPair.fromScalar(BigInt(sdk.hex(blake2s(encoder.encode(password)))) % FIELD_SIZE)
}

async function readEncryptedFile(filepath: string, password: string): Promise<string | undefined> {
  return decrypt(
    password,
    await Bun.file(filepath)
      .text()
      .then(s => s?.trim())
  )
}

async function writeEncryptedFile(
  data: string,
  filepath: string,
  password: string
): Promise<undefined> {
  await Bun.file(filepath).write(encrypt(password, data))
}

function keypath(profile: string = "default"): string {
  return pathJoin(homedir(), ".bermudabay", "cli", profile, "bay_key")
}

function adrsBookPath(profile: string = "default"): string {
  return pathJoin(homedir(), ".bermudabay", "cli", profile, "adrs_book")
}

function encrypt(password: string, data: string): string {
  return decoder.decode(privateEncrypt(pem(password), encoder.encode(data)))
}

function decrypt(password: string, data: string | Uint8Array): string {
  const buf = typeof data === "string" ? encoder.encode(data) : data
  return decoder.decode(privateDecrypt(pem(password), buf))
}

function pem(password: string) {
  return `-----BEGIN PRIVATE KEY-----
${Buffer.from(blake2s(encoder.encode(password))).toString("base64")}
-----END PRIVATE KEY-----`
}

async function prompt(text: string, n: number = 1) {
  const lines = []
  let i = 0
  for await (const line of console) {
    lines.push(line)
    if (++i >= n) {
      break
    }
  }
  return lines.join("").trim()
}

function noop() {}
