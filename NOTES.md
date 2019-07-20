Each users has one or more account.

Each account has an Ed25519 key pair.

Accounts use their key pairs to sign messages.

Each message has an index that positions it on an append-only log specific to that account.

An account's timeline is a reverse-chronological list of their messages.

An account's inbox is a reverse-chronological list of mentions and threads.

A mention is a message from one account that includes the public key of another account.

A reply is a message in response to another message.

A thread is a message plus all of its replies, plus all of their replies, and so on.

An introduction is a mention of two accounts encouraging them to follow each other.

An account follows another account by positing a follow message.
