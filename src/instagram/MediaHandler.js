var log = require("./../util/LogService");
var PubSub = require("pubsub-js");
var InstagramStore = require("./../storage/InstagramStore");
var InstagramApiHandler = require("./InstagramApiHandler");
var WebService = require("./../WebService");
var uuid = require('uuid');
var request = require('request');
var _ = require("lodash");

/**
 * Handles incoming media from Instagram. Supports subscriptions and polling to ensure all known
 * users/accounts are covered.
 */
class MediaHandler {

    /**
     * Creates a new media handler. Prepares the web endpoints and initial setup. Call `prepare` before use.
     */
    constructor() {
        this._expectedTokens = [];
        this._polling = false;

        // This is called after we initiate a request to subscribe, but before we get the all clear on the subscription
        WebService.app.get('/api/v1/media/push/:token', (req, res) => {
            if (!req.params || !req.params['token'] || req.params['token'] !== this._pushToken) {
                log.warn("MediaHandler", "Received invalid subscription GET authorization: Unknown push token");
                res.status(400).send("Invalid push token");
                return;
            }

            var hubMode = req.query['hub.mode'];
            var hubChallenge = req.query['hub.challenge'];
            var hubVerifyToken = req.query['hub.verify_token'];

            if (hubMode != 'subscribe') {
                log.warn("MediaHandler", "Received invalid subscription GET authorization: Invalid hub mode: " + hubMode);
                res.status(400).send('Invalid hub mode');
                return;
            }

            if (this._expectedTokens.indexOf(hubVerifyToken) === -1) {
                log.warn("MediaHandler", "Received invalid subscription GET authorization: Invalid verify token: " + hubVerifyToken);
                res.status(400).send('Invalid verify token');
                return;
            }

            // Remove the token - we're consuming it here
            this._expectedTokens.splice(this._expectedTokens.indexOf(hubVerifyToken), 1);

            log.info("MediaHandler", "Valid parameters received for subscription authorization. Returning challenge");
            res.status(200).send(hubChallenge);
        });

        WebService.app.post('/api/v1/media/push/:token', (req, res) => {
            if (!req.params || !req.params['token'] || req.params['token'] !== this._pushToken) {
                log.warn("MediaHandler", "Received invalid push: Unknown push token");
                res.sendStatus(400);
                return;
            }

            if (!req.body || !_.isArray(req.body)) {
                log.warn("MediaHandler", "Received invalid push: No body or not an array");
                res.sendStatus(400);
                return;
            }

            var promises = [];
            for (var mediaPush of req.body) {
                promises.push(this._processPostedMedia(mediaPush));
            }

            Promise.all(promises).then(() => res.sendStatus(200));
        });
    }

    /**
     * Attempts to process some posted media object
     * @param {*} mediaPush the media that was posted
     * @returns {Promise<>} resolves when the media has been processed
     * @private
     */
    _processPostedMedia(mediaPush) {
        var accountId = mediaPush["object_id"];
        var mediaId = mediaPush["data"]["media_id"];
        var userId = 0;
        var username = "";

        log.info("MediaHandler", "Starting processing on " + accountId + "'s media post: " + mediaId);

        return InstagramStore.findUserByAccountId(accountId).then(user => {
            userId = user.id;
            username = user.username;
            return InstagramApiHandler.media(mediaId);
        }).then(media => {
            if (!media) {
                log.error("MediaHandler", "Could not find media " + mediaId);
                return Promise.resolve();
            }
            return this._tryPostMedia(media, username, userId);
        });
    }

    /**
     * Prepares the media handler for processing media
     * @param {string} clientId the Instagram client ID
     * @param {string} clientSecret the Instagram client secret
     * @param {string} baseUrl the public base URL for the appservice
     */
    prepare(clientId, clientSecret, baseUrl) {
        InstagramStore.getBotAccountData().then(accountData => {
            if (!accountData.mediaHandlerToken) {
                accountData.mediaHandlerToken = uuid.v4();
                return InstagramStore.setBotAccountData(accountData).then(() => accountData.mediaHandlerToken);
            }
            return accountData.mediaHandlerToken;
        }).then(token => {
            this._pushToken = token;
            this._checkSubscription(clientId, clientSecret, baseUrl);
        });

        setInterval(this._pollAccounts.bind(this), 60 * 1000); // check every 60 seconds
        this._pollAccounts();
    }

    /**
     * Polls for account updates. Does not run checks on accounts expected through the subscription API.
     * @private
     */
    _pollAccounts() {
        if (this._polling) {
            log.warn("MediaHandler", "A poll is currently in progress: Skipping check");
            return;
        }

        this._polling = true;

        log.info("MediaHandler", "Calculating list of accounts to poll");
        var accounts = {}; // { userId: User }
        InstagramStore.listUsersWithExpiredMedia().then(users => {
            for (var user of users) {
                accounts[user.id] = user;
            }
            if (users.length == 0) return Promise.resolve([]); // skip extra db call if we're not going to do anything
            return InstagramStore.listTokenUserIds();
        }).then(tokenUserIds => {
            for (var userId of tokenUserIds) {
                accounts[userId] = null;
            }

            var users = _.values(accounts);
            var realUsers = [];
            _.forEach(users, u => {
                if (u) realUsers.push(u);
            });

            var sorted = _.sortBy(realUsers, a => a.mediaExpires);

            log.info("MediaHandler", "Found " + sorted.length + " accounts that need media checks");

            return new Promise((resolve, reject) => {
                var i = 0;
                var handler = () => {
                    if (i < sorted.length) {
                        var user = sorted[i++];
                        this._checkMedia(user.accountId, user.id, user.username).then(() => handler());
                    } else {
                        log.info("MediaHandler", "Finished updating " + sorted.length + " accounts");
                        this._polling = false;
                        resolve();
                    }
                };
                handler(); // invoke
            });
        });
    }

    /**
     * Checks for new media on a given account
     * @param {string} accountId the account ID to check
     * @param {number} userId the bridge's user ID for the account
     * @param {string} username the username for the account
     * @return {Promise<>} resolves when the media check is complete
     * @private
     */
    _checkMedia(accountId, userId, username) {
        return InstagramApiHandler.userMedia(accountId, {count: 1}).then(media => {
            if (!media || media.length == 0) {
                log.info("MediaHandler", "No new media found for " + username);
                return Promise.resolve();
            }

            return this._tryPostMedia(media[0], username, userId);
        });
    }

    /**
     * Attempts to post the Instagram media to the bridge
     * @param {*} media the media object
     * @param {string} username the instagram username
     * @param {number} userId the bridge user ID
     * @return {Promise<>} resolves when processing is complete
     * @private
     */
    _tryPostMedia(media, username, userId) {
        return InstagramStore.isMediaHandled(media['id']).then(isHandled => {
            if (isHandled) {
                log.silly("MediaHandler", "Duplicate media ID: " + media['id']);
                return;
            }

            var contentArray = [];
            var pushContent = (type, content) => contentArray.push({type: type, content: content});

            if (media['type'] == 'image') {
                pushContent('image', media['images']['standard_resolution']);
            } else if (media['type'] == 'video') {
                pushContent('video', media['videos']['standard_resolution']);
            } else if (media['type'] == 'carousel') {
                for (var slide of media['carousel_media']) {
                    if (slide['type'] == 'image') {
                        pushContent('image', slide['images']['standard_resolution']);
                    } else if (slide['type'] == 'video') {
                        pushContent('video', slide['videos']['standard_resolution']);
                    } else log.warn("MediaHandler", "Unknown media type " + slide['type'] + " in carousel");
                }
            } else log.warn("MediaHandler", "Unknown media type " + media['type'] + " for post");

            if (contentArray.length > 0) {
                log.info("MediaHandler", "Post " + media['id'] + " has " + contentArray.length + " attachments");
                PubSub.publish('newMedia', {
                    media: contentArray, // [{ type, content: { url, width, height }}]
                    username: username,
                    caption: media['caption'] ? media['caption']['text'] : null,
                    sourceUrl: media['link'],
                    postId: media['id'],
                    userId: userId
                });
            }
        });
    }

    /**
     * Checks to ensure the Instagram subscription for receiving authenticated media exists
     * @param {string} clientId the Instagram client ID
     * @param {string} clientSecret the Instagram client secret
     * @param {string} baseUrl the base URL to post media to
     * @private
     */
    _checkSubscription(clientId, clientSecret, baseUrl) {
        var cbUrl = baseUrl + "/api/v1/media/push/" + this._pushToken;

        log.info("MediaHandler", "Verifying existence of Instagram subscription");
        var requestOpts = {
            method: 'GET',
            url: 'https://api.instagram.com/v1/subscriptions',
            qs: {
                client_id: clientId,
                client_secret: clientSecret
            }
        };
        request(requestOpts, (err, response, body) => {
            if (err) {
                log.error("MediaHandler", "Error checking for subscriptions. Not processing authenticated media.");
                log.error("MediaHandler", err);
                return;
            }

            var obj = JSON.parse(body);
            if (obj["meta"]["error_message"]) {
                log.error("MediaHandler", "Error checking for subscriptions. Not processing authenticated media.");
                log.error("MediaHandler", obj["error_message"]);
                return;
            }

            var hasSubscription = false;
            for (var subscription of obj["data"]) {
                if (subscription.callback_url == cbUrl && subscription.type == "subscription"
                    && subscription.object == 'user' && subscription.aspect == 'media') {
                    hasSubscription = true;
                    break;
                }
            }

            if (hasSubscription) {
                log.info("MediaHandler", "Subscription to media exists: Not creating.");
            } else {
                log.info("MediaHandler", "Creating subscription to user media");
                var token = uuid.v4();
                this._expectedTokens.push(token);
                requestOpts = {
                    url: 'https://api.instagram.com/v1/subscriptions',
                    method: 'POST',
                    form: {
                        client_id: clientId,
                        client_secret: clientSecret,
                        object: 'user',
                        aspect: 'media',
                        verify_token: token,
                        callback_url: cbUrl
                    }
                };
                request(requestOpts, (err, response, body) => {
                    if (err) {
                        log.error("MediaHandler", "Error checking for subscriptions. Not processing authenticated media.");
                        log.error("MediaHandler", err);
                        return;
                    }

                    var obj = JSON.parse(body);
                    if (obj["meta"]["error_message"]) {
                        log.error("MediaHandler", "Error checking for subscriptions. Not processing authenticated media.");
                        log.error("MediaHandler", obj["meta"]["error_message"]);
                        return;
                    }

                    log.info("MediaHandler", "Media subscription created");
                });
            }
        });
    }

}

module.exports = new MediaHandler();