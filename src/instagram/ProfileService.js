var PubSub = require("pubsub-js");
var request = require("request");
var log = require("./../util/LogService");
var moment = require('moment');
var fs = require("fs");
var InstagramStore = require("./../storage/InstagramStore");
var InstagramApiHandler = require("./InstagramApiHandler");

/**
 * Represents a profile service for Instagram users
 */
class ProfileService {
    constructor() {
        this._profiles = {}; // { handle: { accountId, displayName, avatarUrl, expiration } }
        this._updating = false;
    }

    prepare(profileUpdateFrequency, profileCacheTime, profileUpdatesPerTick) {
        this._cacheTime = profileCacheTime;
        this._maxUpdates = profileUpdatesPerTick;

        return this._loadFromCache().then(() => {
            setInterval(this._checkProfiles.bind(this), profileUpdateFrequency * 60 * 1000);
            this._checkProfiles();
        });
    }

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

    _updateProfile(username, forceUpdate = false) {
        var changed = false;

        log.info("ProfileService", "Updating profile " + username + " (force = " + forceUpdate + ")");
        if (!this._profiles[username]) {
            this._profiles[username] = {
                displayName: null,
                avatarUrl: null,
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

            return InstagramApiHandler.user(accountId);
        }).then(account => {
            if (!account) return;

            if (account.profile_picture != profile.avatarUrl || forceUpdate) {
                profile.avatarUrl = account.profile_picture;
                profile.expires = moment().add(this._cacheTime, 'hours');
                PubSub.publish("profileUpdate", {changed: 'avatar', profile: profile, username: username});
                changed = true;
            }

            if (account.full_name != profile.displayName || forceUpdate) {
                profile.displayName = account.full_name;
                profile.expires = moment().add(this._cacheTime, 'hours');
                PubSub.publish("profileUpdate", {changed: 'displayName', profile: profile, username: username});
                changed = true;
            }

            if (changed) {
                return InstagramStore.getOrCreateUser(username, profile.accountId)
                    .then(user => InstagramStore.updateUser(user.id, profile.displayName, profile.avatarUrl, profile.expires.valueOf()));
            } else return Promise.resolve();
        });
    }

    queueProfileCheck(username) {
        if (!this._profiles[username])
            this._updateProfile(username, true);
        // else the timer will take care of it naturally
    }

    getProfile(username) {
        if (this._profiles[username]) {
            return Promise.resolve(this._profiles[username]);
        } else {
            return this._updateProfile(username, true).then(() => this._profiles[username]);
        }
    }

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

var service = new ProfileService();
module.exports = service;