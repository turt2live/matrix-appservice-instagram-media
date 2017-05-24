var PubSub = require("pubsub-js");
var request = require("request");
var log = require("./../util/LogService");
var moment = require('moment');
var fs = require("fs");
var InstagramStore = require("./../storage/InstagramStore");
var InstagramApiHandler = require("./InstagramApiHandler");
var utils = require("../util/utils.js");
var resemble = require('node-resemble-js');

/**
 * Represents a profile service for Instagram users. Keeps track of profile data, and runs a timer
 * to update this information periodically.
 */
class ProfileService {

    /**
     * Creates a new Instagram profile service. Call `prepare` before use.
     */
    constructor() {
        this._profiles = {}; // { handle: { accountId, displayName, avatarUrl, expiration } }
        this._updating = false;
    }

    /**
     * Prepares the profile service for use. This sets up the timer and starts caching information.
     * @param {number} profileUpdateFrequency how often, in minutes, to perform a profile update check
     * @param {number} profileCacheTime how long, in hours, profile data is cached before re-checked
     * @param {number} profileUpdatesPerTick how many accounts maximum are updated per check
     * @return {Promise<>} resolves when complete
     */
    prepare(profileUpdateFrequency, profileCacheTime, profileUpdatesPerTick) {
        this._cacheTime = profileCacheTime;
        this._maxUpdates = profileUpdatesPerTick;

        return this._loadFromCache().then(() => {
            setInterval(this._checkProfiles.bind(this), profileUpdateFrequency * 60 * 1000);
            this._checkProfiles();
        });
    }

    /**
     * Polls for profile updates. Only checks the most expired profiles up to the user-supplied maximum.
     * @private
     */
    _checkProfiles() {
        if (this._updating) {
            log.warn("ProfileService", "Skipping regular check for profiles: Currently doing profile updates");
            return;
        }

        this._updating = true;

        log.info("ProfileService", "Starting profile update check. Finding first " + this._maxUpdates + " expired profiles");
        var expiredProfiles = [];
        for (var username in this._profiles) {
            var profile = this._profiles[username];
            if (profile.expires.isBefore(moment()))
                expiredProfiles.push({username: username, profile: profile});
        }
        expiredProfiles.sort((a, b) => {
            if (a.profile.expires.isBefore(b.profile.expires))
                return -1;
            if (a.profile.expires.isAfter(b.profile.expires))
                return 1;
            return 0;
        });
        log.verbose("ProfileService", expiredProfiles.length + " profiles are expired.");

        expiredProfiles = expiredProfiles.splice(0, this._maxUpdates); // don't process too much

        // Do a promise loop over the profiles to make sure we don't
        // overrun ourselves with a lot of web requests
        var i = 0;
        var nextProfile = () => {
            if (i >= expiredProfiles.length) {
                this._updating = false;
                return Promise.resolve();
            }

            return this._updateProfile(expiredProfiles[i].username);
        };
        nextProfile().then(() => {
            i++;
            return nextProfile();
        });
    }

    /**
     * Updates a profile. Optionally forcing an upgrade on the spot
     * @param {string} username the Instagram username to update
     * @param {boolean} [forceUpdate] if true, the profile will be updated regardless of expiration
     * @return {Promise<>} resolves when the profile update check is complete
     * @private
     */
    _updateProfile(username, forceUpdate = false) {
        var changed = false;
        var user = null;

        log.info("ProfileService", "Updating profile " + username + " (force = " + forceUpdate + ")");
        if (!this._profiles[username]) {
            this._profiles[username] = {
                displayName: username,
                avatarUrl: 'http://i.imgur.com/DQKje5W.png', // Instagram logo
                accountId: null,
                expires: moment().add(this._cacheTime, 'hours')
            };
            changed = true; // because it's new
        }

        var profile = this._profiles[username];

        var igProfilePromise = Promise.resolve(profile.accountId);
        if (!profile.accountId) {
            igProfilePromise = InstagramApiHandler.userSearch(username, {}).then(result => {
                if (!result || result.length !== 1) {
                    log.warn("ProfileService", "Invalid number of results or bad response trying to look up account ID for " + username);
                    return null;
                }

                profile.accountId = result[0].id;
                changed = true;
                return profile.accountId;
            });
        }

        return igProfilePromise.then(accountId => {
            if (!accountId) {
                log.warn("ProfileService", "Unknown account ID for user " + username + "; Skipping update");
                return null;
            }

            return InstagramStore.getOrCreateUser(username, profile.accountId);
        }).then(dbUser => {
            user = dbUser;
            if (user.isDelisted) return Promise.resolve(null);
            return InstagramApiHandler.user(profile.accountId);
        }).then(account => {
            if (!account || !user) return;

            var aspectPromises = [];

            if (account.profile_picture != profile.avatarUrl || forceUpdate) {
                log.verbose("ProfileService", "Avatar difference for " + username + ". " + (forceUpdate ? "Taking image blindly" : "Checking for image difference"));
                var updatePromise = Promise.resolve(/*doUpdate:*/true);
                if (!forceUpdate) {
                    var currentProfileTempFile = "";
                    var desiredProfileTempFile = "";

                    updatePromise = Promise.all([
                        utils.downloadFileTemp(profile.avatarUrl, '.jpg').then(filepath => currentProfileTempFile = filepath),
                        utils.downloadFileTemp(account.profile_picture, '.jpg').then(filepath => desiredProfileTempFile = filepath)
                    ]).then(() => {
                        return new Promise((resolve, reject) => {
                            resemble(currentProfileTempFile).compareTo(desiredProfileTempFile).onComplete(resolve);
                        });
                    }).then(result => {
                        if (!result.isSameDimensions) return true; // different dimensions are automatically an update
                        if (result.misMatchPercentage > 1) return true; // update if 1% or more different
                        return false;
                    }).then(doUpdate => {
                        try {
                            fs.unlink(currentProfileTempFile);
                            fs.unlink(desiredProfileTempFile);
                        } catch (ignored) {
                            // consume all errors - we don't care
                        }

                        return doUpdate;
                    });
                }

                aspectPromises.push(updatePromise.then(doUpdate => {
                    log.verbose("ProfileService", "Performing avatar update for " + username + " = " + doUpdate);
                    if (!doUpdate) return;
                    profile.avatarUrl = account.profile_picture;
                    profile.expires = moment().add(this._cacheTime, 'hours');
                    PubSub.publish("profileUpdate", {changed: 'avatar', profile: profile, username: username});
                    changed = true;
                }));
            }

            if (account.full_name != profile.displayName || forceUpdate) {
                log.verbose("ProfileService", "Display name changed for " + username);
                profile.displayName = account.full_name;
                profile.expires = moment().add(this._cacheTime, 'hours');
                PubSub.publish("profileUpdate", {changed: 'displayName', profile: profile, username: username});
                changed = true;
                aspectPromises.push(Promise.resolve());
            }

            return Promise.all(aspectPromises);
        }).then(() => {
            if (changed && user) {
                return InstagramStore.updateUser(user.id, profile.displayName, profile.avatarUrl, profile.expires.valueOf());
            } else return Promise.resolve();
        });
    }

    /**
     * Queues a profile check for a given Instagram user
     * @param {string} username the Instagram username to queue for an update
     */
    queueProfileCheck(username) {
        if (!this._profiles[username])
            this._updateProfile(username, true);
        // else the timer will take care of it naturally
    }

    /**
     * Retrieves the profile for an Instagram user. This will try to use the cache where possible,
     * only getting live data if it must.
     * @param {string} username the Instagram username to get the profile of
     * @return {Promise<{username: string, displayName: string, avatarUrl: string}>} resolves to the profile of the user
     */
    getProfile(username) {
        if (this._profiles[username]) {
            return Promise.resolve(this._profiles[username]);
        } else {
            return this._updateProfile(username, true).then(() => this._profiles[username]);
        }
    }

    /**
     * Loads all known users into the profile cache for queued updates
     * @return {Promise<>} resolves when the cache has been populated
     * @private
     */
    _loadFromCache() {
        return InstagramStore.listUsers().then(users => {
            for (var user of users) {
                this._profiles[user.username] = {
                    accountId: user.accountId,
                    displayName: user.displayName,
                    avatarUrl: user.avatarUrl,
                    expires: moment(user.profileExpires)
                }
            }

            log.info("ProfileService", "Loaded " + users.length + " users from cache");
        });
    }
}

module.exports = new ProfileService();