# bin

[![release](https://img.shields.io/github/v/release/bermudabay/bin?include_prereleases)](https://github.com/bermudabay/bin/releases/latest)

Binary providing an easy interface for Bermuda core ops: deposits, transfers, and withdrawals.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/BermudaBay/bin/refs/heads/main/install | /bin/bash
```

## Usage

```sh
bermuda keygen --seed myseed

bermuda address
bermuda balance

bermuda deposit --token eth --amount 0.9 --private-key 0x...
bermuda transfer --to 0x... --token weth --amount 0.3
bermuda withdraw --to 0x... --token weth --amount 0.3 --unwrap
```

<!-- 
## Dev

There are a few patches required to have this run without errors. Because `bun` and `npm`
 seem to be confused and not apply the patches during installation checkout `./patches` to see the required changes.

Furthermore `bun patch --commit 'node_modules/@bermuda/sdk'` crashes with:

```sh
[0.08ms] ".env"
bun patch v1.3.9 (cf6cdbbb)
============================================================
Bun v1.3.9 (cf6cdbbb) macOS Silicon
macOS v14.4
CPU: neon fp aes crc32 atomics
Args: "bun" "patch" "--commit" "node_modules/@bermuda/sdk"
Features: dotenv text_lockfile 
Elapsed: 4ms | User: 7ms | Sys: 5ms
RSS: 9.86MB | Peak: 9.86MB | Commit: 1.07GB | Faults: 35

panic(main thread): Segmentation fault at address 0x176
oh no: Bun has crashed. This indicates a bug in Bun, not your code.

To send a redacted crash report to Bun's team,
please file a GitHub issue using the link below:

 https://bun.report/1.3.9/Mx1cf6cdbbAgwgggC__2hlvF+wmrEuyoqEuv7rE23uwCm1rvCu7hkF2tb+sS__A2AsX

Trace/BPT trap: 5
```

`bun` sometimes causes issues so you might have to switch between `npm` and `bun` at times to resolve issues, fx `bun` fails installing from a github branch while it works with `npm`, see below.

```sh
bun main.js keygen --profile testing --seed myseed
```

```sh
bun main.js address --profile testing
```

```sh
rm -rf node_modules *lock.json
npm i
bun i --lockfile-only
bun run build
# create tag and release manually including binaries as release assets
``` -->