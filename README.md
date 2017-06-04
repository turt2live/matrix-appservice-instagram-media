# matrix-appservice-instagram

[![Greenkeeper badge](https://badges.greenkeeper.io/turt2live/matrix-appservice-instagram.svg)](https://greenkeeper.io/)
[![TravisCI badge](https://travis-ci.org/turt2live/matrix-appservice-instagram.svg?branch=master)](https://travis-ci.org/turt2live/matrix-appservice-instagram) 
[![Targeted for next release](https://badge.waffle.io/turt2live/matrix-appservice-instagram.png?label=sorted&title=Targeted+for+next+release)](https://waffle.io/turt2live/waffle-matrix?utm_source=badge)
[![WIP](https://badge.waffle.io/turt2live/matrix-appservice-instagram.png?label=wip&title=WIP)](https://waffle.io/turt2live/waffle-matrix?utm_source=badge)

Bridges Instagram media to Matrix. Talk about it on Matrix: [#instagram:t2bot.io](https://matrix.to/#/#instagram:t2bot.io)

![instagram-bridge](https://t2bot.io/_matrix/media/v1/download/t2l.io/NoXaWiWBsjtgmjZWmUjJYNfv)

# Requirements

* [NodeJS](https://nodejs.org/en/) (`v6.9` or higher recommended)
* A [Synapse](https://github.com/matrix-org/synapse) server
* An Instagram application to hook up to

# Features

* [x] OAuth with Instagram to avoid rate limit problems
* [x] Handling of authenticated users (subscribe API)
* [x] Posting media to Matrix rooms
* [ ] Hashtag rooms - [#4](https://github.com/turt2live/matrix-appservice-instagram/issues/4)
* [ ] Provisioning API - [#9](https://github.com/turt2live/matrix-appservice-instagram/issues/9)
* [ ] Stats/Monitoring API - [#10](https://github.com/turt2live/matrix-appservice-instagram/issues/10)
* [x] Being able to unsubscribe your account from the bridge - [#15](https://github.com/turt2live/matrix-appservice-instagram/issues/15)

### Things that won't be added

* Matrix to Instagram (prohibited by Instagram)
* Posting media for non-authenticated users (prohibited by Instagram)

# Installation

**Before you begin:** A Synapse server is required. The instructions here assume that Synapse server is a default setup.

1. Clone this repository and install the depdendencies
   ```
   git clone http://github.com/turt2live/matrix-appservice-instagram
   cd matrix-appservice-instagram
   npm install
   ```

2. Copy `config/sample.yaml` to `config/config.yaml` and fill in the appropriate fields
3. Generate the registration file
   ```
   node app.js -r -u "http://localhost:9000" -c config/config.yaml
   ```
   *Note:* The default URL to run the appservice is `http://localhost:9000`. If you have other appservices, or other requirements, pick an appropriate hostname and port.

4. Copy/symlink the registration file to your Synapse directory
   ```
   cd ~/.synapse
   ln -s ../matrix-appservice-instagram/appservice-registration-instagram.yaml appservice-registration-instagram.yaml
   ```

5. Add the registration file to your `homeserver.yaml`
   ```
   ...
   app_service_config_files: ["appservice-registration-instagram.yaml"]
   ...
   ```

6. Restart Synapse (`synctl restart`, for example)

# Running

Using the port specified during the install (`9000` by default), use `node app.js -p 9000 -c config/config.yaml` from the repository directory.

The bridge should start working shortly afterwards.

# Usage

Invite the Instagram account to your room. For example, `@_instagram_turt2live:t2bot.io` will invite turt2live's Instagram virtual user to the room.

Only users that have allowed the bridge to post media will post media in Matrix. To allow the bridge to use your account, open a conversation with `@_instagram:t2bot.io` and send the message `!auth`.

# General information and stuff

This is based off [matrix-appservice-bridge](https://github.com/matrix-org/matrix-appservice-bridge) and uses [instagram-api](https://www.npmjs.com/package/instagram-api) to connect to Instagram for media processing.

Instagram users are encouraged to authenticate with the bridge (in a 1:1 conversation, send `!auth`) so their media can be sent to people on Matrix.

[matrix-appservice-twitter](https://github.com/Half-Shot/matrix-appservice-twitter) was used as a reference implementation of a Synapse appservice - thanks Half-Shot!

The privacy policy can be seen in `PRIVACY_POLICY.md`.