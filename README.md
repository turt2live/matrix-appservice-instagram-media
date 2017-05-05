# matrix-appservice-instagram

[![Greenkeeper badge](https://badges.greenkeeper.io/turt2live/matrix-appservice-instagram.svg)](https://greenkeeper.io/)

Bridges Instagram to [[Matrix]](https://matrix.org).

Matrix room: [#instagram:t2bot.io](https://matrix.to/#/#instagram:t2bot.io)

# Requirements

* [NodeJS](https://nodejs.org/en/) (`v6.9.2` or higher recommended)
* A [Synapse](https://github.com/matrix-org/synapse) server
* An Instagram application to hook up to

# Features

* Current
  * Nothing
* Planned
	* Instagram images automatically posted to rooms
	* Ability to authenticate to speed up posting
	* Joining hashtag rooms
* Not Planned / Not Possible
	* Matrix to Instagram posting (prohibited by Instagram)

# Installation

**Before you begin:** A Synapse server is required. The instructions here assume that Synapse server is a default setup.

1. Clone this repository and install the depdendencies
   ```
   git clone http://github.com/turt2live/matrix-appservice-instagram
   cd matrix-appservice-instagram
   npm install
   ```

2. Copy `config.sample.yaml` to `config.yaml` and fill in the appropriate fields
3. Generate the registration file
   ```
   node app.js -r -u "http://localhost:9000" -c config.yaml
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

Using the port specified during the install (`9000` by default), use `node app.js -p 9000 -c config.yaml` from the repository directory.

The bridge should start working shortly afterwards.

# Usage

## Linking an Instagram account to a room

#### When your homeserver doesn't have the bridge running

Open a 1:1 conversation with `@_instagram:t2bot.io` and send the message `!bridge <room id> <instagram username>`.

For example, `!bridge !kBDEQKODhuvfjxDMAl:t2l.io myinstagram`.

The room must be public (so the bridge can join and start bridging media)

#### When your homeserver has the bridge running

To bridge an instagram such as `myaccount`, join the room `#_instagram_myaccount:domain.com`.

# General information and stuff

This is based off [matrix-appservice-bridge](https://github.com/matrix-org/matrix-appservice-bridge) and uses [instagram-api](https://www.npmjs.com/package/instagram-api) to connect to Instagram for media processing.

Users of the bridge are encouraged to authenticate with the bridge (in a 1:1 conversation, send `!auth`) so the media rate limits can be reduced and spread over the user base. Media will also be posted to the room much faster than without authenticating (as media comes to the bridge for authenticated users, but requires polling when not authenticated).

[matrix-appservice-twitter](https://github.com/Half-Shot/matrix-appservice-twitter) was used as a reference implementation of a Synapse appservice - thanks Half-Shot!

The privacy policy can be seen in `PRIVACY_POLICY.md`.