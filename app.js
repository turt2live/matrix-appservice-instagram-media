var WebHandler = require("./src/WebHandler");
var InstagramOAuth = require("./src/auth/InstagramOAuth");

var web = new WebHandler('0.0.0.0', 4501);
var auth = new InstagramOAuth('XXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXXX');

auth.registerRoutes(web);

console.log(auth.generateAuthUrl("@travis:t2l.io"));