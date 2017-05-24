# matrix-appservice-instagram Privacy Policy

Instagram requires a privacy policy to be published in order for applications to use their API (Application Programming Interface). The Instagram API is required in order for the appservice (or "bridge") to function as it provides the required endpoints to retrieve information.

Users must be aware that [matrix](https://matrix.org) is a **decentralized system** for communication amoungst users. Due to the nature of this system, the appservice, or its maintainers, cannot guarantee what a user's data may be used for once it reaches the open "federation". The "federation" is the collection of matrix servers/nodes that communicate with each other to form the decentralized system. Each server/node may handle the published data differently.

## What data is used?

The appservice collects the following information from all Instagram users affected by the appservice:
* Public username
* Public avatar
* Public media (images, video, etc)

The appservice does *not* collect email addresses, "real" names, addresses, credit card information, or any other potentially sensitive material. The appservice also does not read comments or likes.

## Which accounts are affected?

The appservice will automatically process information received from Instagram for any user who has authorized the bridge using the OAuth flow. The bridge will also process information regularly for publicly accessible accounts that have been chosen by the matrix users to be accessible in matrix. The appservice will not process information for private accounts, even if those users have signed in using the OAuth flow.

## Can I opt out of having my account accessible on matrix?

Yes. To opt out of having your account accessible on matrix, open a new "private chat" with the appservice user on matrix (`@_instagram:t2bot.io`) and send the message `!delist`. The bot may prompt you to authorize it to access your account - this is to ensure that you have permission to access the Instagram account before automatically delisting it. 

The following actions happen when your account is delisted from the appservice:
* All copies of your media/posts will be redacted in all rooms, where possible.
  * The bridge will attempt to tell you if any content could not be removed.
  * *Note*: The appservice cannot delete your data reliably - a distributed system by nature does not permit delete operations, only hide.
* Any future media, until authorized, will not be posted to matrix.

Authorizing (`!auth`) after issuing `!delist` will cause your account to no longer be removed, and people will be allowed to see your future media on Matrix.

## How will my media be used?

As stated in the introduction for this document, the maintainers cannot guarantee how the data will be used once it reaches the federation. The appservice does not save or store your media intentionally and does not perform any additional analysis on the media. The appservice just takes the media posted to Instagram and sends it to a corresponding room on matrix.