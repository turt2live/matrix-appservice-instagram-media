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
        WebService.app.get('/api/v1/media/push', (req, res) => {
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

        WebService.app.post('/api/v1/media/push', (req, res) => {
            console.log(req.body);
            res.sendStatus(200); // so we don't leave them hanging
        });
    }

    /**
     * Prepares the media handler for processing media
     * @param {string} clientId the Instagram client ID
     * @param {string} clientSecret the Instagram client secret
     * @param {string} baseUrl the public base URL for the appservice
     */
    prepare(clientId, clientSecret, baseUrl) {
        this._checkSubscription(clientId, clientSecret, baseUrl);

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
        var newMedia = [];
        var post;
        return InstagramApiHandler.userMedia(accountId, {count: 1}).then(media => {
            newMedia = media;
            if (!newMedia || newMedia.length == 0) {
                log.info("MediaHandler", "No new media found for " + username);
                return Promise.resolve(true); // fake the fact that it is handled because there is no media
            }

            post = media[0];
            return InstagramStore.isMediaHandled(post['id']);
        }).then(isHandled => {
            if (isHandled) {
                log.silly("MediaHandler", "Duplicate media ID: " + post['id']);
                return;
            }

            var contentArray = [];
            var pushContent = (type, content) => contentArray.push({type: type, content: content});

            if (post['type'] == 'image') {
                pushContent('image', post['images']['standard_resolution']);
            } else if (post['type'] == 'video') {
                pushContent('video', post['videos']['standard_resolution']);
            } else if (post['type'] == 'carousel') {
                for (var slide of post['carousel_media']) {
                    if (slide['type'] == 'image') {
                        pushContent('image', slide['images']['standard_resolution']);
                    } else if (slide['type'] == 'video') {
                        pushContent('video', slide['videos']['standard_resolution']);
                    } else log.warn("MediaHandler", "Unknown media type " + slide['type'] + " in carousel");
                }
            } else log.warn("MediaHandler", "Unknown media type " + post['type'] + " for post");

            if (contentArray.length > 0) {
                log.info("MediaHandler", "Post " + post['id'] + " has " + contentArray.length + " attachments");
                PubSub.publish('newMedia', {
                    media: contentArray, // [{ type, content: { url, width, height }}]
                    username: username,
                    caption: post['caption'] ? post['caption']['text'] : null,
                    sourceUrl: post['link'],
                    postId: post['id'],
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
            if (obj["error_message"]) {
                log.error("MediaHandler", "Error checking for subscriptions. Not processing authenticated media.");
                log.error("MediaHandler", obj["error_message"]);
                return;
            }

            var hasSubscription = false;
            for (var subscription of obj["data"]) {
                if (subscription.callback_url == baseUrl + "/api/v1/media/push" && subscription.type == "subscription"
                    && subscription.object == 'user' && subscription.aspect == 'media') {
                    hasSubscription = true;
                    break;
                }
            }

            if (hasSubscription) {
                log.info("MediaHandler", "Subscription to media exists: Not creating.");
            } else {
                var token = uuid.v4();
                this._expectedTokens.push(token);
                requestOpts = {
                    url: 'https://api.instagram.com/v1/subscriptions/',
                    method: 'POST',
                    form: {
                        client_id: this._clientId,
                        client_secret: this._clientSecret,
                        object: 'user',
                        aspect: 'media',
                        verify_token: token
                    }
                };
                request(requestOpts, (err, response, body) => {
                    if (err) {
                        log.error("MediaHandler", "Error checking for subscriptions. Not processing authenticated media.");
                        log.error("MediaHandler", err);
                        return;
                    }

                    var obj = JSON.parse(body);
                    if (obj["error_message"]) {
                        log.error("MediaHandler", "Error checking for subscriptions. Not processing authenticated media.");
                        log.error("MediaHandler", obj["error_message"]);
                        return;
                    }

                    log.info("MediaHandler", "Media subscription created");
                });
            }
        });
    }

}

module.exports = new MediaHandler();