# `ccdrop`

`ccdrop` is an end-to-end encryption file sharing utility. It allows you to send files between devices through a remote server that cannot read the stored data as it's encrypted and decrypted client-side with AES-256-GCM either in the browser or by the cli.

## Installation

### CLI
The easiest version is to use this one-liner to install from the git repository
```
RUSTFLAGS="-C target-cpu=native" cargo install --git 'https://github.com/DawidPietrykowski/ccdrop.git' ccdrop-cli
```

### Server
Use `compose.yaml`
