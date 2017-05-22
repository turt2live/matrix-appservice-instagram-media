var InstagramAPI = require("instagram-api");
var InstagramStore = require("./../storage/InstagramStore");
var log = require("./../util/LogService");

const MAX_RETRY_COUNT = 5; // arbitrary

/**
 * Handles proxying of API calls to help reduce the chance of rate limiting
 */
class InstagramApiHandler {

    constructor() {
    }

    /**
     * Gets an API instance for Instagram
     * @returns {Promise<InstagramAPI>} resolves to an Instagram API
     * @private
     */
    _getApiInstance() {
        return InstagramStore.getRandomAuthToken().then(token => new InstagramAPI(token));
    }

    /**
     * Wraps the API call, handling the rate limit up to MAX_RETRY_COUNT times
     * @param {function} apiFn function to call on the InstagramAPI
     * @private
     */
    _handleRateLimit(apiFn) {
        var tryCount = 0;
        var doCall = () => {
            tryCount++;
            return this._getApiInstance().then(api => apiFn(api));
        };
        return new Promise((resolve, reject) => {
            doCall().then(result => {
                log.info("InstagramApiHandler", "Rate limit results: " + result.remaining + " remaining of " + result.limit + " (for unknown token)");
                resolve(result.data);
            }, err => {
                // TODO: Only handle 429
                log.error("InstagramApiHandler", "Error making request (" + tryCount + "/" + MAX_RETRY_COUNT + " attempts)");
                log.error("InstagramApiHandler", err);
                if (tryCount <= MAX_RETRY_COUNT) {
                    return doCall();
                } else {
                    log.error("InstagramApiHandler", "Failed to perform request. Rejecting request");
                    reject(err);
                }
            });
        });
    }

    // Everything below here is just a proxy call to the InstagramAPI class

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    userSelf() {
        return this._handleRateLimit(api => api.userSelf());
    }

    user(userId) {
        return this._handleRateLimit(api => api.user(userId));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    userSelfMedia() {
        return this._handleRateLimit(api => api.userSelfMedia(userId));
    }

    userMedia(userId, options) {
        return this._handleRateLimit(api => api.userMedia(userId, options));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    userSelfMediaLiked(options) {
        return this._handleRateLimit(api => api.userSelfMediaLiked(options));
    }

    userSearch(term, options) {
        return this._handleRateLimit(api => api.userSearch(term, options));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    userSelfFollows(options) {
        return this._handleRateLimit(api => api.userSelfFollows(options));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    userSelfFollowedBy(options) {
        return this._handleRateLimit(api => api.userSelfFollowedBy(options));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    userSelfRequestedBy(options) {
        return this._handleRateLimit(api => api.userSelfRequestedBy(options));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    userRelationship(userId) {
        return this._handleRateLimit(api => api.userSelfRequestedBy(options));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    setUserRelationship(userId, action) {
        return this._handleRateLimit(api => api.setUserRelationship(userId, action));
    }

    media(mediaId) {
        return this._handleRateLimit(api => api.media(mediaId));
    }

    mediaByShortcode(shortcode) {
        return this._handleRateLimit(api => api.mediaByShortcode(shortcode));
    }

    mediaSearch(options) {
        return this._handleRateLimit(api => api.mediaSearch(options));
    }

    mediaComments(mediaId) {
        return this._handleRateLimit(api => api.mediaComments(mediaId));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    postMediaComment(mediaId, text) {
        return this._handleRateLimit(api => api.postMediaComment(mediaId, text));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    removeMediaComment(mediaId, commentId) {
        return this._handleRateLimit(api => api.removeMediaComment(mediaId, commentId));
    }

    mediaLikes(mediaId) {
        return this._handleRateLimit(api => api.mediaLikes(mediaId));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    postMediaLike(mediaId) {
        return this._handleRateLimit(api => api.postMediaLike(mediaId));
    }

    /**
     * @deprecated This API is not specific, therefore it is unsafe to use user-centric calls
     */
    removeMediaLike(mediaId) {
        return this._handleRateLimit(api => api.removeMediaLike(mediaId));
    }

    getTag(tagName) {
        return this._handleRateLimit(api => api.getTag(tagName));
    }

    getMediasByTag(tagName, options) {
        return this._handleRateLimit(api => api.getMediasByTag(tagName, options));
    }

    searchTags(tagName) {
        return this._handleRateLimit(api => api.searchTags(tagName));
    }

    getLocation(locationId) {
        return this._handleRateLimit(api => api.getLocation(locationId));
    }

    getMediasByLocation(locationId, options) {
        return this._handleRateLimit(api => api.getMediasByLocation(locationId, options));
    }

    searchLocations(options) {
        return this._handleRateLimit(api => api.searchLocations(options));
    }
}

module.exports = new InstagramApiHandler();