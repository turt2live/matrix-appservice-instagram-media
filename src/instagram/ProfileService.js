var PubSub = require("pubsub-js");
var request = require("request");
var log = require("./../util/LogService");
var Q = require('q');
var moment = require('moment');
var fs = require("fs");

/**
 * Represents a profile service for Instagram users
 */
class ProfileService {
    constructor() {
        this._profiles = {}; // { handle: { displayName, avatarUrl, expiration } }
        this._saving = false;
        this._updating = false;

        this._loadFromCache();

        setInterval(this._checkProfiles.bind(this), 30 * 60 * 60 * 1000); // every 30 minutes
        this._checkProfiles();
    }

    _checkProfiles() {
        if(this._updating) {
            log.warn("ProfileService", "Skipping regular check for profiles: Currently doing profile updates");
            return;
        }

        this._updating = true;
        var maxProfiles = 450; // API limit is 600/10min, so we should keep a few for us

        log.info("ProfileService", "Starting profile update check. Finding first " + maxProfiles + " expired profiles");
        var expiredProfiles = [];
        for (var uuid in this._profiles) {
            var profile = this._profiles[uuid];
            if (profile.expires.isBefore(moment()))
                expiredProfiles.push({uuid: uuid, profile: profile});
        }
        expiredProfiles.sort((a, b) => {
            if (a.profile.expires.isBefore(b.profile.expires))
                return -1;
            if (a.profile.expires.isAfter(b.profile.expires))
                return 1;
            return 0;
        });
        log.verbose("ProfileService", expiredProfiles.length + " profiles are expired.");

        expiredProfiles = expiredProfiles.splice(0, maxProfiles); // don't process too much

        // Do a promise loop over the profiles to make sure we don't
        // overrun ourselves with a lot of web requests
        var i = 0;
        var nextProfile = () => {
            if (i >= expiredProfiles.length) return Promise.resolve();
            return this._updateProfile(expiredProfiles[i].uuid);
        };
        nextProfile().then(() => {
            i++;
            return nextProfile();
        });
    }

    _updateProfile(uuid, forceUpdate = false) {
        log.info("ProfileService", "Updating profile " + uuid + " (force = " + forceUpdate + ")");
        if (!this._profiles[uuid])
            this._profiles[uuid] = {displayName: null, expires: moment().add(1, 'hour')};
        var namePromise = UuidCache.lookupFromUuid(uuid).then(profile => {
            if (profile.username != this._profiles[uuid].displayName || forceUpdate) {
                this._profiles[uuid].displayName = profile.displayName;
                this._profiles[uuid].expires = moment().add(1, 'hour');
                PubSub.publish("profileUpdate", {changed: 'displayName', profile: this._profiles[uuid], uuid: uuid});
                this._saveChanges();
            }
        });
        var avatarPromise = this._getProfileImage(uuid).then(response=> {
            if (response.changed || forceUpdate) {
                PubSub.publish("profileUpdate", {
                    changed: 'avatar',
                    profile: this._profiles[uuid],
                    newAvatar: response.image,
                    uuid: uuid
                });
                this._profiles[uuid].expires = moment().add(1, 'hour');
                this._saveChanges();
            }
        });

        return Promise.all([namePromise, avatarPromise]);
    }

    queueProfileCheck(uuid) {
        if (!this._profiles[uuid])
            this._updateProfile(uuid, true);
        // else the timer will take care of it naturally
    }

    /**
     * Gets a profile image for a UUID
     * @param {string} uuid the UUID to lookup
     * @returns {Promise<{image: Buffer, changed: boolean}>} resolves to profile image information, or rejects if there was an error
     * @private
     */
    _getProfileImage(uuid) {
        var deferred = Q.defer();

        log.verbose("ProfileService", "Getting image for " + uuid);
        request('https://crafatar.com/renders/head/' + uuid, {encoding: null}, function (err, response, buffer) {
            if (err) {
                deferred.reject(err);
                return;
            }

            var dto = {
                image: buffer,
                changed: false
            };

            if (response.headers['x-storage-type'] === 'downloaded')
                dto.changed = true;

            log.verbose("ProfileService", "Got profile image for " + uuid + ". Changed = " + dto.changed);

            deferred.resolve(dto);
        });

        return deferred.promise;
    }

    _saveChanges() {
        if (this._saving) {
            log.warn("ProfileService", "Profile service is already saving changes - skipping save call");
            return;
        }

        log.info("ProfileService", "Saving cache to disk");
        this._saving = true;
        fs.writeFile("uuidcache.json", JSON.stringify(this._profiles), {encoding: 'utf8'}, (err) => {
            if (err) {
                log.error("ProfileService", "Error saving cache to disk");
                log.error("ProfileService", err);
            } else log.verbose("ProfileService", "Save completed successfully");
            this._saving = false;
        });
    }

    _loadFromCache() {
        try {
            var response = fs.readFileSync("uuidcache.json", {encoding: 'utf8'});
            if (response)this._profiles = JSON.parse(response);

            // Convert dates to moments
            for (var uuid in this._profiles)
                this._profiles[uuid].expires = moment(this._profiles[uuid].expires);
        } catch (e) {
            if (e.code === 'ENOENT') return; // don't care
            log.error("ProfileService", e);
        }
    }
}

var service = new ProfileService();
module.exports = service;