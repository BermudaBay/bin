# bin

[![release](https://img.shields.io/github/v/release/bermudabay/bin?include_prereleases)](https://github.com/bermudabay/bin/releases/latest)

Binary providing an easy interface for Bermuda core ops: deposits, transfers, and withdrawals.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/bermudabay/bin/refs/heads/main/install | bash
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
