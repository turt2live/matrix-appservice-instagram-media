var InstagramAPI = require("instagram-api");

var api = new InstagramAPI('XXXXXXXXXXX');
api.userSearch('yeg.makerspace').then(results => {
    console.log(results);
    if (results["data"].length !== 1) {
        console.log("Too many or too few results");
        return;
    }

    var id = results["data"][0]["id"];
    return api.userMedia(id);
}, err=> {
    console.error(err);
    throw new Error(err);
}).then(media => {
    console.log(media);
}, err=> {
    console.error(err);
    throw new Error(err);
}).catch(e=> {
    throw new Error("Failed to handle Instagram request", e);
});