
# Tapestry API

## Introduction

The following document describes the JavaScript API that Tapestry uses to process information from the Internet. The components shown below are used to create "connectors" that allow a timeline to be populated from a data source.

This is a work-in-progress and details are certain to change.

> **Note:** The JavaScript in connectors must conform to the [ECMA-262 specification](http://www.ecma-international.org/publications/standards/Ecma-262.htm). This specification defines the language and its basic [functions](https://262.ecma-international.org/14.0/#sec-function-properties-of-the-global-object) and [objects](https://262.ecma-international.org/14.0/#sec-constructor-properties-of-the-global-object). Additions that support the Document Object Model (DOM) and other browser functions are not available.

---
## Changes by Version

Each Tapestry release may add, change, or remove API. A connector opts into a release's behavior with the `minimum_app_version` property in `plugin-config.json`. If that property isn't set, the connector gets the original (pre-1.3) behavior, and newer API is unavailable or ignored.

The list below summarizes what changed at each version so you can upgrade an older connector. Throughout the rest of this document, the **Compatibility** notes spell out the details for each item. When upgrading, start at your connector's current `minimum_app_version` and work forward.

### 2.0

2.0 is the largest change since 1.0, with the big headlines being a **return-based interface** and a new **composing** capability — plus supporting additions to items and actions and the JavaScript environment.

**Data types are plain JavaScript objects.** `Item`, `Draft`, and the attachment types are now plain `kind`-tagged objects rather than host-exported classes. The `create…` factories still work and still stamp the `kind` for you, but you can now build any object as a literal and mutate it freely in place — and the newer composing structures (`rules`, attributes, attachment entries) are just literals, with no factory of their own. Mostly transparent if you already use the factories; see [Objects](#objects).

**Interface functions** [`load()`](#load), [`verify()`](#verify), and [`performAction()`](#performaction) now **return** their results and **throw** an `Error` to report failure, instead of calling separate completion functions:

  * `load()` returns an `Array` of `Item`s and ends when it returns; [`processResults()`](#processresults) still delivers incrementally, but its `isComplete` argument is now ignored.
  * `verify()` returns the verification result — an `Object` or a display-name `String`.
  * `performAction(actionId, item, actionValue)` returns its result; `actionValue` moved to the trailing position as a compatibility hook for items created by a pre-2.0 connector.
  * `processError()`, `processVerification()`, and `actionComplete()` are no longer provided when targeting 2.0 — throw an `Error` instead.

**Items** carry their own metadata and **actions** got new behaviors:

  * [`item.metadata`](#metadata-dictionary) — a per-item `[String: String]` bag for the data an action needs (actions read from it instead of an `actionValue`).
  * [`item.actions`](#actions-set) is a `Set` of action ids, managed with `item.actions.add(id)` / `item.actions.delete(id)` (replacing the old per-action value strings).
  * optional [presentation attributes](#action-presentation) on an action — `priority`, `group`, and `destructive` — control where and how it appears.
  * [`Item.delete(uri)`](#removing-an-item) reports an item as removed (from `load()` or `performAction()`), so a connector can delete a post or reconcile content that no longer exists.

**Composing** lets an action open a composer and create posts:

  * the [`compose`](#action-roles) action role, the [`target`](#action-target) action attribute, and the [`Draft`](#draft) object (for example, replying to a post).
  * composer content fields (`body` / `title` / `contentWarning`), a live character counter, and connector-declared setting attributes (visibility, language, per-post permissions, …) — declared per-draft with [`draft.rules`](#rules-object), the user's choices arriving in [`draft.attributeValues`](#attributevalues-dictionary).
  * quote posts — put the quoted [`Item`](#item) in [`draft.attachments`](#attachments-array-of-item) (the same shape as a read-side quote attachment).

**Expanded JavaScript environment** with support for the following common web APIs: [`crypto.randomUUID()`](#cryptorandomuuid) (random UUIDs, e.g. for idempotency keys), [`TextEncoder`/`TextDecoder`](#textencoder-and-textdecoder) (UTF-8 ↔ bytes, e.g. for byte offsets), and [`btoa`/`atob`](#btoa-and-atob) (base64).

Connectors that do **not** set `minimum_app_version` to 2.0 keep all pre-2.0 behavior unchanged, including the old completion functions, and do not get the new JavaScript environment functions.

### 1.4

  * **Added** — an optional [`role`](#action-roles) on actions, plus the `"context"` role for actions that return a conversation thread.
  * **Added** — `performAction` (via `actionComplete()`) can return an `Array` of `Item`s, used by context actions.

### 1.3

  * **Added** — [`sendConditionalRequest()`](#sendconditionalrequest) for HTTP conditional (304 Not Modified) requests.
  * **Added** — [`PollAttachment`](#pollattachment) and [`PollOption`](#polloption); the [`Item.attachments`](#attachments-array-of-mediaattachment-and-linkattachment-and-item-and-pollattachment) array can also contain `Item` instances for "quoted post" presentation.
  * **Changed** — [`xmlParse()`](#xmlparse), [`plistParse()`](#plistparse), and [`extractProperties()`](#extractproperties) return a `Promise` (asynchronous) instead of returning a value synchronously.

### 1.0

The original API. `load()`, `verify()`, and `performAction()` report results through the `processResults()`, `processVerification()`, and `actionComplete()` functions, and report failures with `processError()`. These remain the behavior for any connector with `minimum_app_version` < 2.0.

---
## Variables

Any variables that have been specified in `ui-config.json` are set before the script is executed. For example, the Mastodon connector specifies the following inputs:

```json
{
	"inputs": [
		{
			"name": "site",
			"type": "url",
			"prompt": "Instance",
			"validate_as": "url",
			"placeholder": "https://mastodon.social"
		}
	]
}
```

The current value for the `site` input will be set before the `plugin.js` script is executed. This lets the script adapt to use `mastodon.social`, `mastodon.art`, etc. with code such as this:

```javascript
sendRequest(site + "/api/v1/timelines/home?limit=40")
```

See the Configuration section below for the specification of `ui-config.json` and each input/variable.

---
## Objects

Tapestry's content types — `Item`, `Identity`, `Annotation`, `MediaAttachment`, `LinkAttachment`, `PollAttachment`, and `PollOption` — are **plain JavaScript objects**. The `create…` factory functions documented below are conveniences that stamp the correct shape for you (each object's `kind`, and an empty `actions` Set on an item). You are free to build and return object literals of the same shape instead — these two are equivalent:

```javascript
const item = Item.createWithUriDate(uri, date);
item.title = "Hello.";

// …is the same as…

const item = { kind: "item", uri: uri, date: date, actions: new Set(), title: "Hello." };
```

Every object carries a `kind` (`"item"`, `"identity"`, `"media"`, `"link"`, `"poll"`, …) so Tapestry knows what it is; the factories set it. An `Item` may omit `kind` — an untagged object in an item position is read as an item — but an attachment literal **must** include its `kind` so it's recognized. Each object's section below documents its shape.

**Factories exist only for these top-level `kind`-tagged types** (and, for composing, [`Draft`](#draft)) — use a factory or a literal, your choice. The *nested, fixed-shape* parts of a `Draft` — its [`rules`](#rules-object), the setting attributes, the character counter, and the like — carry no `kind` and have **no** factory of their own; you write them as plain object literals. That split is deliberate: a factory only earns its place where it stamps a `kind`, so the absence of, say, a `Choice.create()` is by design, not an omission.

To leave a value unset (nil on the Tapestry side), simply don't set the property:

```javascript
const item = Item.createWithUriDate(uri, date);
if (myContent != null) {
	item.body = myContent;
}
```

A `String` property also accepts a number or boolean and stores its string form (`42` → `"42"`); any other type mismatch is ignored rather than raising an error.

---
### Item

`Item` objects are used to populate a timeline in the app. Items can be either posts or articles. You create one with:

```javascript
const uri = "https://example.com/unique/path/to/content";
const date = new Date();
const item = Item.createWithUriDate(uri, date);
item.title = "Hello.";
item.body = "<p>This is <em>a contrived</em> example, but <b>so what?</b></p>";

```

#### uri: String (required)

A unique URI for the item on the Internet. Used to show details in a browser (assuming the URI is a valid HTTP URL).

#### date: Date (required)

The date and time when the post was created.

#### title: String

The title.

#### body: String

Text with HTML formatting that will be displayed for the post. See the end of this document for how this content and its formatting is used.

#### contentWarning: String

Adds a content warning to the item and blurs any attachments.

#### author: Identity

The creator of the content. See `Identity` below.

#### annotations: Array of Annotation

Extra context to display alongside the item, such as a "Boosted by" note. See `Annotation` below.

#### attachments: Array of MediaAttachment and LinkAttachment and Item and PollAttachment

Media, link, poll, and quoted item attachments for the content. See `MediaAttachment`, `LinkAttachment`, and `PollAttachment` below.

As of 1.3, the `attachments` array can also include ordinary `Item` instances to achieve a "quoted post" presentation when needed.

> **Note:** If the `provides_attachments` configuration parameter is not set or false, attachments will be generated automatically using the elements of the `body` HTML. If no other media attachments in the item have been set, inline images and videos will be used to create media attachments automatically. Additionally, the first link in the first paragraph will be checked for a link attachment. See the section on HTML Content for more information.

> **Compatibility:** Requires `minimum_app_version` >= 1.3; ignored by older versions.

#### shortcodes: Dictionary

This property contains a dictionary of name and URL pairs. Shortcodes are used to process any content in the `Item` or the author `Identity`. Text that uses the `:shortcode:` convention will be replaced by an image at display. For example:

```javascript
item.body = "<p>THE :ONE: AND ONLY :CHOCK: WAS HEAR</p>";
item.shortcodes = { "ONE": "https://example.com/one.jpg", "CHOCK": "https://chocklock.com/favicon.ico" };
```

Shortcode tokens must not contain spaces or additional colons: using `:my fancy code:` or `:what:the:hell:` is invalid and will be ignored. 

#### actions: Set

The set of actions available for the item — on 2.0+ a `Set` of action-id strings. Manage it with the native Set methods `item.actions.add(id)` / `item.actions.delete(id)` (and `item.actions.has(id)`), and store any data the actions need in `metadata`. (An array of ids — `item.actions = ["favorite", "boost"]` — is also accepted.) See the `actions.json` section.

#### metadata: Dictionary

A per-item bag of `String` key/value pairs for the connector's own use — most commonly the identifiers an action needs when it's performed, then read back from `item.metadata` in `performAction`. See the `actions.json` section.

> **Compatibility:** Requires `minimum_app_version` >= 2.0.

#### Removing an Item

A connector can report that an item no longer exists, so that Tapestry removes it from the timeline (and from any open conversation thread). Instead of an `Item`, return a *removal*, created with `Item.delete()`:

```javascript
const removal = Item.delete(uri);
```

The `uri` is the same value the item was created with — that's all Tapestry needs to identify it. A removal can go anywhere an `Item` can, mixed freely into the `Array` returned from `load()` or `performAction()`. For example, a "delete post" action removes the post on the service and then returns a removal for it:

```javascript
async function performAction(actionId, item, actionValue) {
	if (actionId == "delete") {
		await sendRequest(`${site}/api/v1/statuses/${item.metadata.id}`, "DELETE");
		return [Item.delete(item.uri)];
	}
}
```

A removal returned from `load()` lets a connector that can discover deleted content reconcile those removals as the timeline refreshes.

You may optionally pass the time the removal happened as a second argument — `Item.delete(uri, date)`. If omitted, the current time is used. When an item and a removal for the same `uri` are seen together, the newer-dated one wins, so a removal dated earlier than a fresh version of the item is ignored (and a removal you date in the past won't undo a more recent update).

> **Compatibility:** Requires `minimum_app_version` >= 2.0; ignored by older versions.

---
### Identity

An `Item` can have a author that indicates how the content was created. It can be a person, a woman, a man, a camera, or a TV. The information is used to present an avatar and display name in the timeline. Feed verification can also optionally return an `accountIdentity`.

```javascript
const name = "CHOCK OF THE LOCK";
const identity = Identity.createWithName(name);
identity.uri = "https://chocklock.com";
identity.avatar = "https://chocklock.com/favicon.ico";

item.author = identity;
```

An `Identity` instance can also be constructed with the `create()` function which takes each of the properties in order:

```javascript
item.author = Identity.create("CHOCK OF THE LOCK", null /* username */, "https://chocklock.com/favicon.ico", "https://chocklock.com");
```

#### name: String (required)

The name of the creator. Can be an account’s full name, a bot name, or anything to identify the data and source.

#### username: String

The name of the creator. Can be an account’s full name, a bot name, or anything to identify the data and source.

#### avatar: String

A string containing the URL for the creator’s avatar on the Internet. A Base64 encoded data URL can be used, if needed. If no avatar is specified a generic image will be displayed in the timeline.

#### uri: String

A unique URI for the creator on the Internet. Can be an individual’s account page, bot, or other type of creator. Will be used to show details for the creator if the URI can be converted to a browsable URL.

---
### Annotation

An `Item` can have annotations that indicates how the content arrived in the timeline. It can be used for boosts, replies, reposts, reblogs, or any other type of reference.

```javascript
const text = "CHOCK STAR";
const annotation = Annotation.createWithText(text);
annotation.icon = "https://chocklock.com/favicon.ico";
annotation.uri = "https://chocklock.com";

item.annotations = [annotation];
```

#### text: String (required)

The text for the annotation. It can be anything, but will be most useful to the user as something like "@chockenberry Boosted".

#### icon: String

A string containing a URL for the annotation’s icon. If no icon is specified only the text will be displayed in the timeline.

#### uri: String

A URI with more information about the annotation. For things like boosts/reposts/reblogs that are done by an account the user follows, a link to the account listed in the annotation would be appropriate.

---
### MediaAttachment

`Item`s can also have media attachments. Photos, videos, and audio are commonly available from APIs and other data sources, and this is how you get them into the timeline. They will be displayed under the HTML content. (A media attachment's `kind` is `"media"`; the factory sets it — include it if you build a literal.)

```javascript
const attachment = MediaAttachment.createWithUrl(url);
attachment.mimeType = "image/gif";
attachment.text = "Yet another cat on the Internet.";
attachment.aspectSize = {width: 300, height: 400};
attachment.focalPoint = {x: 0, y: 0};

item.attachments = [attachment];
```

The supported file formats and extensions for images are:

  * PNG (Portable Network Graphic) - .png
  * TIFF (Tagged Image File Format) - .tiff or .tif
  * JPEG (Joint Photographic Experts Group) - .jpeg or .jpg
  * GIF (Graphic Interchange Format) - .gif (pronounced with a [soft G](https://en.wikipedia.org/wiki/Pronunciation_of_GIF)
  * BMP (Windows Bitmap Format) - .bmp or .BMPf
  * Windows Icon - .ico
  * Windows Cursor - .cur
  * XWindow bitmap - .xbm

The supported file formats and extensions for audio and video are:

  * AAC - .aac
  * AIFF - .aiff
  * AIFF Compressed - aifc
  * AVI - .avi
  * Audio Codec 3 (Dolby) - ac3
  * MPEG-4 Audio and Video - .mp4
  * MPEG-2 Video - .m2v
  * MPEG-2 Transport Stream - .ts
  * MPEG-1 Video - .mpg
  * MPEG-1 Audio Layer 2 - .mp2
  * MPEG-1 Audio Layer 3 - .mp3
  * Unix Audio - .au
  * 3GPP Container - .3gp, .3g2

An HLS playlist (.m3u8) should be specified explicitly as "video" or "audio" since Tapestry has no mechanism to examine the contents of the playlist.

#### url: String (required)

A string containing the URL for the media on the Internet. A Base64 encoded data URL can be used, if needed.

#### thumbnail: String

A string containing the URL for a lower resolution copy of the media. This is assumed to be an image file.

#### mimeType: String

A string that lets Tapestry know what kind of media is being attached. Currently supported types are "image", "video", and "audio". A subtype, such as "jpeg", "png", or "gif" can be supplied, but does not affect how the media is displayed.

If this value isn't provided, the file name extension for `url` will be used. If there is no file extension, "image" will be assumed.

Note that playlists, such as .m3u8, will be assumed to be audio (based upon the file extension). If the playlist contains video, set the `mimeType` explicitly to "video/mp4".

#### blurhash: String

A string that provides a placeholder image.

#### text: String

A string that describes the media (for accessibility)

#### aspectSize: Object

An object with `width` and `height` properties. The values are used to optimize the media placement in the timeline.

#### focalPoint: Object

An object with `x` and `x` properties. The values are used to center media in the timeline. If no values are specified, the center at (0, 0) is assumed.

---
### LinkAttachment

A link attachment's `kind` is `"link"`; the factory sets it — include it if you build a literal.

#### url: String (required)

A string containing the URL for the link on the Internet.

#### type: String

The type of link, typically an Open Graph [og:type](https://ogp.me/#types).

#### title: String

The title for the link, typically an Open Graph [og:title](https://ogp.me/#metadata).

#### subtitle: String aka "description"

The subtitle for the link, typically an Open Graph [og:description](https://ogp.me/#optional).

#### siteName: String

The site name for the link, typically an Open Graph [og:site\_name](https://ogp.me/#optional).

#### authorName: String

The author's name, typically as [HTML author metadata](https://www.w3.org/TR/2011/WD-html5-author-20110809/the-meta-element.html#meta-author).

#### authorProfile: String

A URL for the author, typically from [fediverse:creator](https://blog.joinmastodon.org/2024/07/highlighting-journalism-on-mastodon/).

#### image: String

An image for the link, typically the Open Graph [og:image](https://ogp.me/#metadata).

#### blurhash: String

A string that provides a placeholder image.

#### aspectSize: Object

An object with `width` and `height` properties, typically from Open Graph [og:image:width](https://ogp.me/#structured) and [og:image:height](https://ogp.me/#structured).

---
### PollAttachment

Used for attaching information about a poll to an `Item`. A poll attachment's `kind` is `"poll"`; the factory sets it — include it if you build a literal. (Polls require `minimum_app_version` 1.3 or higher.)

```javascript
const attachment = PollAttachment.create();
attachment.options = [ PollOption.create("Option 1", 16), PollOption.create("Option 2", 26) ];
attachment.endDate = new Date();

item.attachments = [attachment];
```

#### options: Array of PollOptions (required)

An array of `PollOption` objects for each option in the poll.

#### endDate: Date (optional)

An optional date that the poll ends. If not specified, Tapestry renders the poll without showing a countdown time label.

#### multipleChoice: Bool (default false)

Set to `true` if the poll allows mutliple choices or not.

> **Compatibility:** Requires `minimum_app_version` >= 1.3.

---
### PollOption

Used to define an option for a `PollAttachment`.

```javascript
const a = PollOption.create("Zero votes.", 0);
const b = PollOption.create("This has 16 votes.", 16);
const c = PollOption.create("Unspecified votes.");
const poll = PollAttachment.create([a, b, c]);
```

#### title: String (required)
#### votes: Number (optional)

If `votes` is left unspecified on one or more options in a `PollAttachment`, Tapestry will not show vote totals or percentages.

> **Compatibility:** Requires `minimum_app_version` >= 1.3.

---
### Draft

A `Draft` represents something the user is composing, such as a reply. An action with the [`compose`](#action-roles) role returns a `Draft` from `performAction()` to open the composer; a *submit* action (see [`target`](#action-target)) then receives the edited `Draft` and creates the post. Create one with:

```javascript
const draft = Draft.create();
draft.header = "Reply to @alice";   // the composer's heading (chrome — not part of the post)
draft.body = "@alice ";             // the post text
draft.actions.add("send");
```

The draft's content properties — `body`, `title`, and `contentWarning` — mirror the same properties on an [`Item`](#item): a `Draft` is the writable half of a post. Pre-fill any of them and read them back when submitting.

#### body: String

The main post text. Pre-fill it (for example, a reply's mention) and read it back when submitting. Mirrors [`item.body`](#body-string).

#### title: String

An optional post title, for services that have one (a blog post, say). Mirrors [`item.title`](#title-string). The composer shows an editor for it only if [`rules.fields`](#rules--content-fields-and-character-counting) lists `title`.

#### contentWarning: String

An optional content warning / spoiler shown before the body. Mirrors [`item.contentWarning`](#contentwarning-string). The composer shows an editor for it only if [`rules.fields`](#rules--content-fields-and-character-counting) lists `contentWarning`.

#### header: String

A heading shown at the top of the composer, such as "Reply to @alice". This is composer chrome that labels the editor — it is *not* part of the post (contrast with `title`, which is post content).

#### context: Array of Item

Posts to display above the composer for context — for a reply, the post being replied to. This is display only; a connector carries the actual reply references in `metadata`.

#### attachments: Array of Item

Content embedded *in* the post, shown **below** the editor (contrast with `context`, which shows above it). This is how you **quote** a post: put the [`Item`](#item) being quoted into the array. It mirrors the read side, where an embedded `Item` in [`item.attachments`](#attachments-array-of-mediaattachment-and-linkattachment-and-item-and-pollattachment) is likewise a quoted post — so a quote crosses the bridge in exactly the same shape whether it's being read or composed.

`attachments` is for **display** — the composer renders the embedded `Item` as a quote preview. To *build* the quote at submit, don't dig the reference back out of the attachment: when you build the draft (you already have the item in hand), stash the identifiers you need in the draft's own [`metadata`](#metadata-dictionary-1) — exactly as you carry a reply's references there. Same split as `context` vs. the reply refs: the post to *show* rides `attachments`, the reference you *post with* rides `metadata`.

The property is an array so the shape can grow, but a quote is a single embedded post. (Media and poll attachments on a draft are a later addition; today only an embedded `Item` quote is supported.)

#### metadata: Dictionary

A `[String: String]` bag of connector state that round-trips with the draft, exactly like [`item.metadata`](#metadata-dictionary) — for example the id of the post being replied to and an idempotency key. It is not shown to the user.

#### actions: Set

The ids of the *submit* actions that apply to this draft (the buttons shown in the composer), managed like `item.actions` with `draft.actions.add(id)` / `draft.actions.delete(id)`. Each such action must declare `target: "draft"` in `actions.json`.

#### feedback: String

An optional message shown to the user when a submit is returned to the composer for a correction (see [`performAction`](#performaction)).

#### attributeValues: Dictionary

A `[String: String]` map holding the user's current choice for each *setting attribute* declared in [`rules.attributes`](#rules--setting-attributes), keyed by the attribute's `name`. The composer seeds it from each attribute's `defaultValue` and updates it as the user changes controls; read it back when submitting — for example `draft.attributeValues.visibility`. A `multiple` attribute's value is the selected values comma-joined.

#### rules: Object

Connector-declared rules that tell the composer how to behave for this draft: which content fields it offers and how they're counted, and the *setting attributes* it presents (visibility, language, per-post permissions, …). Unlike the properties above, these are not user content — the app reads them to drive the composer — so set what applies and omit the rest.

##### rules — content fields and character counting

Declares which content fields the composer offers, how each is measured/shaped, and the length limits. Counting is evaluated entirely in the app — the draft is never sent back to the connector to be measured — so you *declare* the weighting.

```javascript
draft.rules = {
    characterUnit: "graphemes",   // "graphemes" | "codepoints" | "utf16" — how text is measured, service-wide
    // The single visible "N remaining" counter. Its limit may span several fields. Omit → no counter shown.
    characterCounter: {
        fields: ["body", "contentWarning"],       // fields whose counts sum toward this limit
        characterLimit: { maxLength: 500 }         // maxLength and/or maxBytes
    },
    // The content fields the composer offers — a field not listed isn't enabled. Keys: body | title | contentWarning.
    fields: {
        body: {
            placeholder: "What's on your mind?",    // empty-field prompt (often different for a reply)
            weights: {                              // per-field weighting — applies to THIS field only
                "https?://[^\\s]+": 23,             // every URL counts as 23
                "(@\\w+)(@[\\w.-]+)?": "$1"         // a mention counts only "@user" — the @domain is free
            }
        },
        contentWarning: { availability: "hidden", placeholder: "Write your warning here" }
    }
};
```

  * **characterUnit** — `"graphemes"` (default), `"codepoints"`, or `"utf16"`. Shared by every field.
  * **characterCounter** — the one prominent counter. `fields` are summed (each counted with its *own* `weights`); `characterLimit` is `{ maxLength?, maxBytes? }` (a byte cap catches emoji-heavy text). Omit `characterCounter` entirely and no visible counter is shown.
  * **fields** — a map keyed by `body` / `title` / `contentWarning`; listing a field is what enables it in the composer (an unlisted field isn't offered at all). Each value is optional and may set:
    * **weights** — a regex mapped to a number (a fixed cost — a URL = 23) or `"$N"` (the length of capture group *N* — counting only a mention's `@user`). It applies to *this field only*, so a URL in a content warning isn't weighted like one in the body. Overlaps resolve leftmost-first (longest on a tie), so order doesn't matter.
    * **characterLimit** — an independent `{ maxLength?, maxBytes? }` cap on just this field (a title ≤ 100), separate from `characterCounter`.
    * **placeholder** — the prompt shown in the field's editor while it's empty (e.g. `"What's on your mind?"`, or `"Post your reply"` for a reply). Omit for the composer's own default.
    * **availability** — one word for how the composer offers the field (default `"always"`):
        * `"always"` — shown and cannot be hidden; but the user may leave it empty.
        * `"required"` — always shown *and* mandatory; a submit is blocked if it's empty.
        * `"shown"` — shown by default, but the user can toggle it off and leave it empty.
        * `"hidden"` — hidden by default, but the user can toggle it on to fill it in.

##### rules — setting attributes

`rules.attributes` is an array of *setting controls* the composer presents alongside the content fields — the knobs the app has no built-in concept of, such as post visibility, language, or who may reply. Each is a small control the app renders in the composer; the user's current choice for each lives in [`draft.attributeValues`](#attributevalues-dictionary), keyed by `name`. Read those back when submitting.

```javascript
draft.rules = {
    // …content fields / characterCounter as above…
    attributes: [
        {
            name: "visibility",             // key into draft.attributeValues
            prompt: "Visibility",           // the control's label
            // `type` defaults to "single". A two-choice "single" stands in for an on/off switch, so every
            // control has a value to show — there is no switch type here (unlike ui-config.json).
            defaultValue: "public",
            icon: "globe",                  // SF Symbol for the control's chip in the composer bar
            choices: [
                { value: "public",  prompt: "Public",    description: "Anyone on and off",   icon: "globe" },
                { value: "private", prompt: "Followers", description: "Only your followers", icon: "lock" }
            ]
        },
        {
            name: "replyAudience",
            prompt: "Who can reply",
            type: "multiple",               // pick several; the value is the chosen values comma-joined
            defaultValue: "everybody",
            requireSelection: true,         // the user can't clear the selection entirely
            description: "Everybody can reply by default. Choose “Nobody”, or combine groups.",
            choices: [
                { value: "everybody", prompt: "Everybody", exclusive: true },  // clears the others when picked
                { value: "nobody",    prompt: "Nobody",    exclusive: true },
                { value: "mentioned", prompt: "Mentioned users" },
                { value: "following", prompt: "People you follow" }
            ]
        },
        {
            name: "quotePolicy",
            prompt: "Who can quote",
            defaultValue: "public",
            availableWhen: { attribute: "visibility", oneOf: ["public"] },   // unavailable otherwise
            choices: [
                { value: "public", prompt: "Anyone" },
                { value: "nobody", prompt: "Just me" }
            ]
        },
        { name: "language", type: "language" }   // app-populated OS language list (ISO 639-1 codes)
    ]
};
```

Each attribute has these properties:

  * **name** (required) — the key the user's choice is stored under in `draft.attributeValues`.
  * **type** — `"single"` (default; pick one of `choices`), `"multiple"` (pick several; the stored value is the chosen values comma-joined), or `"language"` (a picker the app fills from the OS language list as ISO 639-1 codes — `choices` is ignored, and the app supplies a default label and icon you may override).
  * **prompt** — the control's label. Optional; `"language"` supplies its own, and `"single"`/`"multiple"` fall back to `name`.
  * **description** — an optional longer explanation shown under the prompt.
  * **defaultValue** — the value seeded into `attributeValues` when the composer opens (comma-joined for `"multiple"`).
  * **choices** — an array of `{ value, prompt, description?, icon?, exclusive? }`: `value` is stored, `prompt` is the label, and an optional `description` shows as a second line under the label (e.g. a visibility option's "Only your followers"). An optional `icon` (SF Symbol) becomes the bar chip's glyph while that choice is selected — so the chip reflects the current value at a fixed width (Mastodon visibility uses `globe` / `moon` / `lock` / `at`). Without an icon the chip falls back to the first two letters of the selected choice's prompt. In a `"multiple"`, `exclusive: true` makes a choice clear the others when picked (and any other choice clears it) — for example a "Everybody" that can't coexist with narrower groups.
  * **requireSelection** — for a `"multiple"`, forbid an empty selection (the user must keep at least one).
  * **icon** — an SF Symbol name for the control's chip in the composer bar.
  * **availableWhen** — `{ attribute, oneOf }`: the control is unavailable unless `attributeValues[attribute]` is one of `oneOf` — it dims and, when the user opens it, the popover explains the condition (e.g. "Available only when Visibility is Public"). This is presentational only — still guard which values you actually apply when submitting.

> **Compatibility:** Requires `minimum_app_version` >= 2.0.

---
## Interface Functions

The Tapestry app will call the following functions in `plugin.js` when it needs the script to read or write data. If no implementation is provided, no action will be performed. For example, some sources will not need to `verify()` themselves.

These functions are asynchronous (they may be declared `async` and/or return a Promise). `load()`, `performAction()`, and `verify()` report their results by returning a value, and report a failure by throwing an `Error`.

---
### verify

`verify()`

Determines if a site is reachable and gathers properties for the feed. Once verification succeeds a feed can be saved by a user.

This function will only be called if `needs_verification` is set to true in the connectors’s configuration.

The properties returned can be user visible or used internally. An example of the former case is a display name will be used identify the feed. The latter case is a base URL that will be used to handle relative paths in the feed.

Return the verification result — an object with the properties below, or a `String` to use as the display name. Throw an `Error` if the site can't be verified.

The returned object can contain these properties (all are optional):

  * displayName: `String` with a suggested name for a feed (e.g. an account name, blog name, etc.).
  * icon: `String` with a URL to an image that can be used as a graphic attached to the feed (e.g. an avatar).
  * baseUrl: `String` with a URL prefix for relative paths.
  * accountIdentity: `Identity` object that represents the logged in account for the feed.

> **Note:** A `baseUrl` is typically used for feeds where the site is "feed.example.com" but images and other resources are loaded from "example.com".

For authenticated feeds (such as social media accounts), we suggest supplying an `accountIdentity` object (created with `Identity.create()`) that is configured with the user's display name, username, and avatar.

When a Tapestry user adds multiple feeds for the same connector that requires authentication (such as multiple Mastodon accounts), the information in `accountIdentity` can help the user tell the items from each feed apart in their timelines. For feeds without any associated user authentication, an `accountIdentity` will have little effect and isn't necessary.

If `icon` or `displayName` are omitted, then the ones supplied by `accountIdentity` will be used instead, if possible.

> **Compatibility:** When `minimum_app_version` < 2.0, the result is reported by calling `processVerification()` (and failures via `processError()`) rather than returned/thrown.

---
### load

`load()`

Implement this function to load new data and return it as an `Array` of `Item` objects. Throw an `Error` to report a failure. Variables can be used to determine what to load — for example, whether to include mentions on Mastodon or not.

Optionally, you can deliver items incrementally — for example, from several separate requests — by calling `processResults()` as each batch arrives; returning from `load()` always ends the load.

The array may also include *removals* if the connector can discover that content has been deleted — see [Removing an Item](#removing-an-item).

> **Compatibility:** When `minimum_app_version` < 2.0, `load()` returns nothing — results are delivered with `processResults()`, the load ends when its `isComplete` flag is true, and errors are reported with `processError()`.

---
### performAction

`performAction(actionId, target, actionValue)`

Tapestry calls this function when an action needs to be performed by the connector.

  * actionId: A `String` with the action id
  * target: the subject of the action, which follows the action's [`target`](#action-target) attribute — the `Item` the action was requested for (the default), or a [`Draft`](#draft) for a `target: "draft"` action. Handlers that only deal with items commonly name this parameter `item`, which is fine for that case.
  * actionValue: A compatibility hook you can usually ignore. Data for an action lives in `item.metadata`; `actionValue` carries the value stored for this action on items created by a *pre-2.0* version of the connector (before `metadata` existed), letting a connector migrating from an older version fall back to it. It is an empty string for items created by a 2.0+ connector.

Any data an action requires can be set in (and then read from) `item.metadata` or any other item property as needed. After performing the action, return the result: the updated `Item`, an `Array` of `Item`s (for context actions), or nothing. Throw an `Error` to report a failure. The array may also include *removals* to delete items — for example, a "delete post" action returns a removal for the post. See [Removing an Item](#removing-an-item).

> **Note:** Only one action per feed is allowed to be running at a time.

> **Compatibility:** When `minimum_app_version` < 2.0, the argument order is `performAction(actionId, actionValue, item)` and the result is reported via `actionComplete()` rather than returned. On >= 2.0 the result is returned (or an `Error` thrown), and `actionValue` moved to the trailing position as the compatibility hook described above.

#### Composing

An action with the [`compose`](#action-roles) role returns a [`Draft`](#draft) instead of items, which opens the composer. The composer's *submit* actions declare [`target: "draft"`](#action-target), so for those `performAction`'s second argument is the edited `Draft` rather than an `Item`. A submit action then either:

  * **returns the created `Item`(s)** (or nothing) — success; the composer closes.
  * **returns a `Draft`** — sends the user back to the composer to fix something; set `draft.feedback` to explain why.
  * **throws an `Error`** — reports a failure; the composer stays open with the draft intact.

For example, a `reply` action opens a composer and a `send` action creates the post:

```javascript
async function performAction(actionId, target, actionValue) {
    if (actionId == "reply") {
        const item = target;   // the reply action's target is the item being replied to
        const draft = Draft.create();
        draft.header = "Reply to " + item.author.name;    // composer heading (not part of the post)
        draft.body = item.author.username + " ";          // pre-fill the mention
        draft.context = [item];
        draft.metadata = { replyTo: item.metadata.id, idempotencyKey: crypto.randomUUID() };
        draft.rules = {
            fields: { body: {} },
            attributes: [ { name: "language", type: "language" } ]   // offer a language picker
        };
        draft.actions.add("send");
        return draft;
    }
    else if (actionId == "send") {
        const draft = target;   // the send action's target is the Draft being submitted
        const body = {
            status: draft.body,
            language: draft.attributeValues.language,     // the user's setting-attribute choice
            in_reply_to_id: draft.metadata.replyTo
        };
        const headers = { "content-type": "application/json", "Idempotency-Key": draft.metadata.idempotencyKey };
        const response = await sendRequest(`${site}/api/v1/statuses`, "POST", JSON.stringify(body), headers);
        const post = JSON.parse(response);
        return [ Item.createWithUriDate(post.url, new Date(post.created_at)) /* …fill in the rest… */ ];
    }
}
```

See the section on `actions.json` for more information on how to define and perform actions.

---
## Utility Functions

The following functions are available to the script to help it perform the actions listed above.

---
### sendRequest

`sendRequest(url, method, parameters, extraHeaders, fullResponse) → Promise`

Sends a request. If configured, a bearer token will be included with the request automatically.

  * url: `String` with the endpoint that will be retrieved.
  * method: `String` with the HTTP method for the request (default is "GET").
  * parameters: `String` with the parameters for HTML body of "POST" or "PUT" request. For example: "foo=1&bar=something" (default is null).
  * extraHeaders: `Dictionary` of `String` key/value pairs. They will be added to the request (default is null for no extra headers).
  * fullResponse: `Boolean` which causes response to include status code, headers, and body text.
  
Returns a `Promise` with a resolve handler with a String parameter and a reject handler with an Error parameter. The resolve handler’s string is:

> **Note:** The `url` is assumed to be properly encoded. Use JavaScript’s `encodeURI`, if needed.

For the "HEAD" method, the string result contains a JSON dictionary containing the HTTP status code, the response headers, and the URL that was loaded (which may be different than the request due to redirects):
  
```json
{
	"status": 404,
	"headers": {
		"last-modified": "Thu, 02 Mar 2023 21:46:29 GMT",
		"content-length": "15287",
		"...": "..."
	},
	"url": "https://example.com/redirect"
}
```

All successful requests return a string. Typically this will be HTML text or a JSON payload created from the response body. Regular expressions can be used on HTML and `JSON.parse` can be used to build queryable object. For XML text, `xmlParse()` can convert it to an object. In all cases, the data extracted will be returned to the Tapestry app.

The `parameters` string and values in `extraHeaders` can contain patterns that will be replaced with values managed by the Tapestry app:

  * `__ACCESS_TOKEN__` The access token returned when authenticating with OAuth or JWT.
  * `__CLIENT_ID__` The client ID used to identify the connector with the API.

For example, if you need to "POST" the client ID, you would use "client=\_\_CLIENT\_ID\_\_&text=foo" for the `parameters`. If you need this information in a header, use:

```javascript
	let extraHeaders = { "X-Client-Id", "__CLIENT_ID__" };
	sendRequest(url, "GET", null, extraHeaders)
	...
```

The `fullResponse` flag can be set to `true`. In this mode, the text response is a JSON dictionary that contains all the results from the request:

```json
{
	"status": 200,
	"headers": {
		"last-modified": "Thu, 02 Mar 2023 21:46:29 GMT",
		"content-length": "15287",
		"...": "..."
	},
	"url": "https://example.com/redirect",
	"body": "<!DOCTYPE html> ..."
}
```

#### EXAMPLE

A Mastodon user’s identity is determined by sending a request to verify credentials:

```javascript
async function verify() {
	const text = await sendRequest(site + "/api/v1/accounts/verify_credentials");
	const jsonObject = JSON.parse(text);

	const displayName = "@" + jsonObject["username"];
	const icon = jsonObject["avatar"];

	return {
		displayName: displayName,
		icon: icon
	};
}
```

> **Note:** The JavaScript code doesn’t have access to the OAuth access token (for security, no authentication information is exposed to the connector). If an access token is needed in a list of `parameters`, use `__ACCESS_TOKEN__` — it will be substituted before the request is sent to the endpoint.

---
### sendConditionalRequest

`sendConditionalRequest(url, method, parameters, extraHeaders, fullResponse) → Promise`

This performs an [HTTP conditional request](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Conditional_requests). 

The behavior is nearly identical to `sendRequest()` with one very important difference: If `fullResponse` is false or unspecified and the server responds with an `HTTP 304 Not Modified` response, the value returned by the promise will be `null`.

The purpose of this is to make it faster to check when content has changed since the last time it was requested. Internally the request's `url` is used as a key to record the modified date and/or etag as returned by the server. That information is then automatically added to the headers of your next conditional request for that same `url` so the server can know how to respond.

For feed-like data sources (such as RSS), this often results in a very significant speedup because it avoids re-downloading and re-importing unchanged content.

> **Note:** Not all web servers are correctly configured to support conditional requests. If the server doesn't send the required headers or otherwise ignores them, this function will fallback to behaving identically to `sendRequest()`.

> **Compatibility:** Requires `minimum_app_version` >= 1.3.

---
### lookupIcon

`lookupIcon(url) → Promise`

  * url: `String` with a path to an HTML page
  
Returns a `Promise` with a resolve handler that includes a `String` parameter with a path to an icon for the page. If no icon can be found, a `null` value is returned.

---
### processResults

`processResults(results)`

Delivers a batch of retrieved items to the Tapestry app. Call this from `load()` to deliver items incrementally as they arrive (for example, from several separate requests). The load ends when `load()` returns. See the [Mastodon connector](https://github.com/TheIconfactory/Tapestry/blob/main/Plugins/org.joinmastodon/plugin.js) for an example.

  * results: `Array` with `Item` objects. The array may also include *removals* — see [Removing an Item](#removing-an-item).

> **Compatibility:** When `minimum_app_version` < 2.0, `processResults(results, isComplete)` takes a second `Boolean` (default true) that ends the load when true — connectors making several requests needed a reference counter to know when to set it. On >= 2.0, completion is signaled by `load()` returning and the `isComplete` argument is ignored.

---
### processError

`processError(error)` *(deprecated)*

> **Compatibility:** Only for `minimum_app_version` < 2.0. On >= 2.0, throw an `Error` from `load()`, `performAction()`, or `verify()` instead — it reports the failure the same way.

Sends an error to the Tapestry app for display.

  * error: `Error` which indicates what went wrong. Will be displayed in the user interface.

---
### processVerification

`processVerification(verification)` *(deprecated)*

> **Compatibility:** Only for `minimum_app_version` < 2.0. On >= 2.0, `verify()` returns the verification result (or throws) instead.

Reports the result of verification. The `verification` value — a result `Object` or a `String` display name — takes the same form documented under `verify()`.

---
### actionComplete

`actionComplete(results, error)` *(deprecated)*

> **Compatibility:** Only for `minimum_app_version` < 2.0. On >= 2.0, `performAction()` returns its result and throws an `Error` to report a failure instead.

Indicates that the action has been performed. Must be called.

  * results: An `Item` or Array of `Item`s that were updated. A null value indicates there were no results.
  * error: If not null, the `Error` indicates what went wrong and will be displayed in the user interface.

See section on `actions.json` for more information on how to complete actions. (Returning an array of `Item`s requires `minimum_app_version` >= 1.4.)

---
### xmlParse

`xmlParse(text) → Object | Promise`

  * text: `String` is the text representation of the XML data.

If `minimum_app_version` is `1.3` or higher, this returns a `Promise` which asynchronously returns an `Object` or raises an error.

If `minimum_app_version` is unspecified or below `1.3`, this synchronously returns an `Object` or throws an error.

> **Note:** Do not assume that the order of the keys in the object dictionaries will be the same as they occurred in the XML. No order is preserved during processing (as is the case with JSON parsing).

To deal with the differences between XML and JavaScript objects (JSON), some processing is done on the XML.

If the XML has multiple nodes with the same name, they are put into an array. For example, the following XML:

```xml
<root>
	<metadata>Example</metadata>
	<entry>
		<title>First</title>
	</entry>
	<entry>
		<title>Second</title>
	</entry>
</root>		
```

Will generate:

```json
{
	"root": {
		"metadata": "Example",
		"entry": [
			{
				"title": "First"
			},
			{
				"title": "Second"
			}
		]
	}
}
```

When evaluating the result, you can use JavaScript’s `instanceof` operator. Using the example above, `object.root.entry instanceof Array` will return true, while `object.root instanceof Array` will return false. You can also use `Object`’s `.getOwnPropertyNames(object)` to get a list of properties generated for the node: in the example above, the properties of `object.root` are `[metadata,entry]`.

A node’s attributes are stored in a sibling object with a "$attrs" key. The dollar sign was chosen because it’s an invalid XML node name, but is a valid JavaScript property name. This makes it easy to access with a path like `object.root.node$attrs`.

For example, this XML:

```xml
<root>
	<node first="1" second="2" third="3">value</node>
</root>
```

Produces:

```json
{
	"root" : {
		"node" : "value",
		"node$attrs" : {
			"first" : "1",
			"second" : "2",
			"third" : "3"
		}
	}
}
```

Note that these two processing steps can be combined in some cases. An example is multiple link nodes with nothing but attributes:

```xml
<root>
	<link first="abc" second="def" />
	<link first="hij" second="klm" />
</root>
```

Will only produce attribute dictionaries:
 
```json
{
	"root" : {
		"link$attrs" : [
			{
				"first" : "abc",
				"second" : "def"
			},
			{
				"first" : "hij",
				"second" : "klm"
			}
		]
	}
}
```

Note also that text that’s not a part of a node will be ignored. For example:

```xml
<root>
	text
	<node>value</node>
</root>
```

Results:

```json
{
	"root" : {
		"node" : "value"
	}
}
```

XML elements with type "xhtml" will generate the node and its children as described above. It will also provide a text representation of those nodes in a "$xhtml" sibling object. This is mainly a convenience for parsing XHTML content elements in Atom RSS feeds:

```javascript
	if (entry.content$attrs["type"] == "xhtml") {
		content = entry.content$xhtml;
	}
	else {
		content = entry.content;
	}
```

Finally, not all XML nodes will be accessible with a object property path. An XML node with a namespace will be represented as `namespace:key` and that’s an invalid identifier in JavaScript. You will need to access these values using the index operator instead: `object["namespace.key"]`.

This functionality should be enough to parse XML generated from hierarchical data, such as an RSS feed generated by a WordPress database of posts.

> **Compatibility:** Returns a `Promise` when `minimum_app_version` >= 1.3; synchronous below that.

---
### plistParse

`plistParse(text) → Object | Promise`

  * text: `String` is the text representation of the property list data formatted as XML.

If `minimum_app_version` is `1.3` or higher, this returns a `Promise` which asynchronously returns an `Object` or raises an error.

If `minimum_app_version` is unspecified or below `1.3`, this synchronously returns an `Object` or throws an error.

Note that old style property lists or JSON property lists are not supported.

> **Compatibility:** Returns a `Promise` when `minimum_app_version` >= 1.3; synchronous below that.

---
### extractProperties

`extractProperties(text) → Object | Promise`

  * text: `String` is HTML content with `<meta>` properties (such as Open Graph).

If `minimum_app_version` is `1.3` or higher, this returns a `Promise` which asynchronously returns an `Object` or raises an error.

If `minimum_app_version` is unspecified or below `1.3`, this synchronously returns an `Object` or throws an error.

The `Object` representation contains the HTML’s properties. These values can be used to generate link previews or enhance the content without scraping the markup.

> **Compatibility:** Returns a `Promise` when `minimum_app_version` >= 1.3; synchronous below that.

---
### setItem

`setItem(key, value)`

  * key: `String` a key for value being stored.
  * value: `String` to be saved in local storage.
  
Items can be removed from local storage by passing a `null` value. The amount of local storage is limited to 100,000 total characters and any items set beyond that threshold will be ignored.
  
---
### getItem

`getItem(key) → String`

  * key: `String` a key for value that was stored.
  
Returns a `String` that was saved in local storage. If no value was stored, `null` is returned.

---
### clearItems

`clearItems()`

All items in local storage are removed.

---
### crypto.randomUUID

`crypto.randomUUID() → String`

Returns a new, randomly generated UUID `String` (for example, `"9b2e5c1a-4f7d-4a2e-8c1b-0a1b2c3d4e5f"`). Useful for idempotency keys and other unique identifiers. This matches the standard browser and Node.js `crypto.randomUUID()`.

> **Compatibility:** Requires `minimum_app_version` >= 2.0.

---
### TextEncoder and TextDecoder

`new TextEncoder().encode(string) → Uint8Array`
`new TextDecoder().decode(bytes) → String`

Convert between a `String` and its UTF-8 bytes (a `Uint8Array`) — the standard web Encoding API, which JavaScriptCore does not include. Useful whenever you need UTF-8 **byte** positions rather than character positions; for example, Bluesky richtext facets are expressed as UTF-8 byte offsets.

```javascript
const bytes = new TextEncoder().encode("hi 👋");           // a Uint8Array (8 bytes)
const emoji = new TextDecoder().decode(bytes.slice(3, 7)); // "👋"
```

This is a minimal polyfill — `encode`/`decode` only, UTF-8 only.

> **Compatibility:** Requires `minimum_app_version` >= 2.0.

---
### btoa and atob

`btoa(binaryString) → String`
`atob(base64String) → String`

Base64-encode (`btoa`) and decode (`atob`), matching the standard web functions that JavaScriptCore does not include. Following the web spec, `btoa` takes a "binary string" whose character codes are all in the range 0–255 (it throws otherwise). To base64 arbitrary Unicode text, encode it to UTF-8 bytes first:

```javascript
const b64 = btoa(String.fromCharCode(...new TextEncoder().encode("héllo")));
```

> **Compatibility:** Requires `minimum_app_version` >= 2.0.

---
### require

`require(resourceName) → Value | Object | String | false`

  * resourceName: `String` with the name of a text resource to load.
  
The connector folder can contain a folder named "resources". The files in that folder are loaded using this function.

The resource’s file name extension determines what type of data is returned:

  * **".js"** causes the contents of the file to be evaluated and any resulting value is returned. This can be used to define functions that are used by `plugin.js` and allow you to organize and share your code. Any errors during evaluation will throw an exception that’s displayed in the user interface.
  * **".json"** parses the contents of the file and returns the resulting `Object`. If no object can be parsed, `false` is returned.
  * Any other extension, including **".txt"** returns the contents of the file as a UTF-8 `String`.
  * If the file contains any other kind of data, such as an image, `false` is returned.

Files in resources folder can be symbolic links (not aliases) to other files in the folder that contains the connectors. This way the connectors "com.example.one" and "com.example.two" can share common code in a single file. When you save a connector, the symbolic links are resolved and stored individually in the resulting .tapestry file.

If you are loading functions, errors can be detected with a `false` return value:

```javascript
if (require('utility.js') === false) {
	throw new Error("Failed to load utility.js");
}
```

This can be extended to ensure that `String` and `Object` are loaded correctly.

```javascript
let template = require('template.txt');
if (template === false) {
	throw new Error("Failed to load template")
}
else {
	console.log(`template = ${template}`)
}
```

If you have used Node.js’s module loading, the approach above is very similar approach. Note that there is no need to export functions from the .js file that is being loaded: all functions and variables in the file are exported.

---
### raiseCondition

`raiseCondition(condition, title, description)`

Raises an persistent error condition that will be presented as a fatal error to the user:

  * type: A `String` with the type of condition: either "authorize" or "disable".
  * title: A `String` with a short description of the condition.
  * message: A `String` with a longer description.

When "authorize" is used, the authorization tokens for the feed will be removed. A prominent user interface will prompt the user to reauthorize the feed.

When "disable" is used, the condition is displayed prominently and the user will be given an option to disable the feed.

Any other `type` is ignored.

---
## Configuration

Each connector is defined using the following files:

  * `plugin-config.json` (Required)
  * `ui-config.json` (Optional)
  * `plugin.js` (Required)
  * `README.md` (Recommended)
  * `suggestions.json` (Optional)
  * `apps.json` (Optional)
  * `discovery.json` (Optional)
  * `actions.json` (Optional)
  
The contents of each of these files is discussed below, in the same order.

---
### plugin-config.json

Required properties:

  * id: `String` with reverse domain name for uniqueness (e.g. org.joinmastodon or blog.micro)
  * display_name: `String` with name that will be displayed in user interface

Recommended properties:

  * site: `String` with the primary endpoint for the connector's API. This parameter is used in several different contexts:
  
  	- If not provided, the user will be prompted for a URL during setup. If you are accessing an API with a single endpoint, please provide a value. In cases where each instance of the source will need its own site, for example a Mastodon instance or an RSS feed, do not provide a value and let the user set it up.
  	- The value will also be used as a base URL for relative authentication URLs (see the _NOTE_ below).
  	- The configured value or a value provided by the user will be provided as as JavaScript variable.
  	- The configured value or a value provided by the user will be used to control when Tapestry sends an "Authorization" HTTP header. If the request's scheme is "https" on the default port (443) and the same domain or subdomain of `site`, the header will be included. 

  * site\_prompt: `String` with a prompt for user input.
  * site\_placeholder: `String` with a placeholder for user input.
    - If no `site` is configured, these properties are required.
  * site\_default: `String` with a default value for user input. Unlike `site`, this value is editable by the user. Use this when there’s a sensible default server but the user may need to change it (e.g. a self-hosted instance).
  * site\_help: `String` with a short description of what’s required for `site`.
 
  * icon: `String` with a URL to an image that will be used as a default for this connector.
  * service\_name: `String` with the name of the service (e.g. "Tumblr", "YouTube", "Blog", "Podcast").
  * default\_color: `String` with a default color name for feeds created by the connector. Valid values are "purple", "gold", "blue", "coral", "slate", "orange", "green", "teal". If no value is specified, "gray" will be used.
  * item\_style: `String` with either "post" or "article" to define the content layout.
  * version: `Number` with an integer value that increments with newer versions of the connector. If no value is supplied, 1 is assumed.
  * crosstalk: `String` with "inclusive", "exclusive", or "disabled". See the explanation of these modes below.
  * minimum\_app\_version: `String` with the version number of the Tapestry app that must be used for the connector. If the app version is lower than the specified value, the connector will be ignored until a newer version is installed. **Some API behaviors are also influenced by this setting!**
  
Optional properties:

  * needs\_verification: `Boolean` with true if verification is needed (by calling `verify()`)
  * verify\_variables: `Boolean` with true if variable changes cause verification. Use this option if changing a variable will affect  loading content (because its a part of a URL, for example).
  * provides\_attachments: `Boolean` with true if connector generates attachments directly, otherwise post-processing of HTML content will be used to capture images, videos, and link previews.
  * authorization\_header: `String` with a template for the authorization header. If no value is specified, "Bearer \_\_ACCESS\_TOKEN\_\_" will be used. See below for options.
  * refresh\_status\_code: `Number` with the HTTP status code that indicates authorization needs to be refreshed. Default value is 401. A value of 0 will not attempt to refresh tokens.
  * check\_interval: `Number` with number of seconds between load requests (currently unimplemented).
  * synchronizable\_credentials: `Boolean` allows feed authentication tokens to by synced using iCloud keychain when `true` (default is `true`).
  * hidden\_tag\_classes: `Array` of `String`s of HTML CSS class names. HTML tags in an item's body with a matching class will be hidden when rendering the item preview for the timeline.

Optional OAuth properties:

  * register: `String` with endpoint to register the Tapestry app (e.g. "/api/v1/apps").
  * oauth\_authorize: `String` with endpoint to authorize account (e.g. "/oauth/authorize").
  * oauth\_token: `String` with endpoint to get bearer token (e.g. "/oauth/token").
  * oauth\_type: `String` with response type parameter (currently, only "code" is supported).
  * oauth\_code\_key: `String` with code result from authorize endpoint (e.g "code").
  * oauth\_scope: `String` with scope used to register and get token (e.g. "read+write+push").
  * oauth\_grant\_type: `String` with grant type (currently, only "authorization\_code" is supported).
  * oauth\_http\_redirect: `Boolean`, with true, the OAuth redirect URI will be "https://iconfactory.com/tapestry-oauth", otherwise "tapestry://oauth" is used.
  * oauth\_basic\_auth: `Boolean`, with true, the client id and secret will be added to a Basic authentication header when generating or refreshing tokens.
  * oauth\_authorize\_omit\_secret: `Boolean`, with true, the client secret will not be sent to the `oauth_authorize` endpoint. This is needed for Google's OAuth 2.0 server.
  * oauth\_extra\_parameters: `String` with extra parameters for authorization request (e.g. "&duration=permanent&foo=bar")
  * needs\_api\_keys: `Boolean`, with true, user interface will prompt for OAuth API keys and store them securely in the user's keychain. Ignored if a `register` endpoint is specified or if there is no `oauth_authorize` endpoint.

Optional JWT properties:

  * jwt\_prompt: `String` with account information needed to login (e.g. "Email Address").
  * jwt\_authorize: `String` with endpoint to authorize account (e.g. "/xrpc/createSession").
  * jwt\_refresh: `String` with endpoint to refresh account (e.g. "/xrpc/refreshSession").

> **Note:** When using OAuth, Tapestry looks for `access_token` and `refresh_token` during the token exchange. With JWT, `accessJwt` and `refreshJwt` are used. These values are stored securely in the users' keychain.

> **Note:** The oauth\_authorize, oauth\_token, jwt\_authorize, and jwt\_refresh endpoints can be relative or absolute URLs. Relative paths use the `site` variable above as a base (allowing a single connector to support multiple federated servers, like with Mastodon). Absolute paths allow different domains to be used for the initial authorize and token generation (as with Tumblr).

The `authorization_header` string provides a template for the API endpoints. The following items in the string will be replaced with values managed by the Tapestry app:

  * `__ACCESS_TOKEN__` The access token returned when authenticating with OAuth or JWT.
  * `__CLIENT_ID__` The client ID used to identify the connector with the API.
  
For example, a string value of `OAuth oauth_consumer_key="__CLIENT_ID__", oauth_token="__ACCESS_TOKEN__"` will generate the following header:

	Authorization: OAuth oauth_consumer_key="dead-beef-1234" oauth_token="feed-face-5678"

Any credentials collected by Tapestry are used automatically during a `sendRequest`. An authorization header will be added when the following are true:

  * URL scheme is HTTPS
  * Port is 443
  * The host is a domain or subdomain of the feed's URL. For example, if the feed originates at `example.com`, requests to `api.example.com` will get the header, but requests to `1337hacker.com` will not.

Connectors can be configured for Tapestry’s Crosstalk feature using the `crosstalk` property. The options are:

  * `inclusive`: Crosstalk checks items in this connector’s feeds and all items in other feeds where Crosstalk is enabled. This is the default behavior.
  * `exclusive`: Crosstalk is only checked with items from other feeds that _do not_ use this connector. If two items are similar and use the same connector, they are _not marked_ as Crosstalk. This mode is used by some connectors to prevent daily items from being labeled as Crosstalk even though they have very similar content ("FoxTrot" and "FoxTrot Classics", for example).
  * `disabled`: Opts this connector entirely out of Crosstalk. Items from feeds using this connector will never be checked or labeled as Crosstalk even if they are similar to an item in another feed.
  
#### EXAMPLES

The configuration for the Mastodon connector is:

```json
{
	"id": "org.joinmastodon",
	"display_name": "Mastodon",
	"register": "/api/v1/apps",
	"oauth_authorize": "/oauth/authorize",
	"oauth_token": "/oauth/token",
	"oauth_type": "code",
	"oauth_code_key": "code",
	"oauth_scope": "read+write+push",
	"oauth_grant_type": "authorization_code",
	"provides_attachments": true,
	"check_interval": 300
}
```

The configuration for the JSON Feed connector is:

```json
{
	"id": "org.jsonfeed",
	"display_name": "JSON Feed",
	"needs_verification": true,
	"check_interval": 300
}
```
 
---
### ui-config.json

The user interface in the Tapestry app is configured with this file. A connector can have any number of inputs, specified as an `Array`. Each input has this required property:

  * name: `String` with the name of the input. This value is used to generate variables for `plugin.js`.

And these optional properties:

  * type: `String` with the type of input: "text", "switch", "choices".
  * prompt: `String` with the name displayed in the user interface.
  * placeholder: `String` with a placeholder value for the user interface.
  * value: `String` with a default value.
  * choices: `String` with a comma separated list of values that will be displayed in a menu.

If no `prompt` is specified, the capitalized name of the variable is used. If no `type` is specified, "text" will be assumed.

A variable with the type `switch` will present a switch in the configuration interface and sets a value of "on" or "off" (the default value). A `choices` type uses a popup menu with the strings in a comma separated list, with the default being the first item in the list.

Multiple inputs with the same name will result in undefined behavior. It won’t act predicably in the configuration interface or `plugin.js`.

These variables, and the changes that each user makes to them, are persisted by Tapestry. If the configuration of the inputs changes, existing values will be maintained and any new variables will get a default value. Variables that are removed from the configuration will also be removed from the user's persisted values.

#### EXAMPLE

Here is an example of the different kinds of variables:

```json
{
	"inputs": [
		{
			"name": "simple"
		},
		{
			"name": "title",
			"type": "text",
			"placeholder": "Enter a description"
		},
		{
			"name": "turbo",
			"type": "switch",
			"prompt": "TURBO",
			"placeholder": "No default value, will be 'off'"
		},
		{
			"name": "reticulate_splines",
			"type": "switch",
			"prompt": "Reticulate Splines",
			"value": "on",
			"placeholder": "When enabled, splines will be reticulated"
		},
		{
			"name": "dessert_choice",
			"type": "choices",
			"prompt": "Dessert Choice",
			"value": "Banana Cream Pie",
			"choices": "Apple Pie,   Banana Cream Pie,Chestnut Pie, Doomsday Cake, Everything Bagel",
			"placeholder": "Choose your dessert"
		}
	]
}
```

---
### plugin.js

A JavaScript file that implements the Actions specified above using the Functions listed above. This is the file that pulls all the pieces described above into code that gets data and transforms it for use in the universal timeline.

The following `plugin.js` script is used in a connector that retrieves all recent earthquakes from the U.S. Geological Survey (USGS). This is all that's needed to create posts for the universal timeline:

```javascript
async function load() {

	let summaryName = "4.5_day";
	
	const endpoint = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${summaryName}.geojson`;

	const responseText = await sendRequest(endpoint);
	const jsonObject = JSON.parse(responseText);

	const features = jsonObject["features"];

	let results = [];
	for (const feature of features) {
		const properties = feature["properties"];
		const url = properties["url"];
		const date = new Date(properties["time"]);
		const text = properties["title"];

		const geometry = feature["geometry"];
		const coordinates = geometry["coordinates"];
		const latitude = coordinates[1];
		const longitude = coordinates[0];
		const mapsUrl = "https://maps.apple.com/?ll=" + latitude + "," + longitude + "&z=8";

		const content = "<p>" + text + " <a href=\"" + mapsUrl + "\">Open Map</a></p>"

		let resultItem = Item.createWithUriDate(url, date);
		resultItem.body = content;

		results.push(resultItem);
	}
	return results;
}
```

This connector took about an hour to write with no prior knowledge of the API or data formats involved. All of the connectors in the current version of the Tapestry app range in length from about 50 to 200 lines of code (including comments).

---
### README.md

This file, formatted with Markdown, is displayed in Tapestry when the user views your connector’s information. It is highly recommended since it provides valuable context for the end user.

Only inline styles are supported (e.g. no `#` header blocks or images). This is a limitation of displaying Markdown in user interface controls on Apple platforms. 

Here is an example:

```markdown
This connector displays a feed of earthquakes from around the world. The feed is
generated by the [USGS](https://earthquake.usgs.gov).

The feed can be configured to show significant quakes or ones above a certain
threshold on the Richter scale.

This first connector for Tapestry was written by Craig Hockenberry 
([@chockenberry](https://mastodon.social/@chockenberry)) while creating a prototype.
```

---
### suggestions.json

The contents of this file will help the user setup the connector. There are two types of suggestions: one for site URLs and another for settings.

For example, the RSS connector suggests a few sites to help someone set up a feed the first time:

```json
{
	"sites": [
		{
			"value": "https://feeds.kottke.org/main",
			"title": "Kottke"
		},
		{
			"value": "https://www.apple.com/newsroom/rss-feed.rss",
			"title": "Apple Newsroom"
		}
	]
}
```

Settings for variables can also be suggested. The `name` parameter should match the one in `ui-config.json`. The `title` should be kept fairly short because of the width limitations on mobile devices:

```json
{
	"variables": [
		{
			"name": "reticulate_splines",
			"value": "false",
			"title": "ECO Mode"
		},
		{
			"name": "message",
			"value": "Now is the time for all good men to come to the aid of their party",
			"title": "Long Message"
		},
		{
			"name": "short",
			"value": "Hi.",
			"title": "Short",
		}
	]
}
```

If multiple names and values are needed, the following form can be used:

```json
	"variables": [
		{
			"title": "@Gargron",
			"names": [
				"account",
				"site"
			],
			"values": [
				"Gargron",
				"https://mastodon.social"
			]
		}
	]
```

---
### apps.json

The contents of this file will help the user select a native app to be used by feeds created with this connector.

```json
{
	"apps": [
		{
			"id": "com.github.feditext",
			"name": "Feditext",
			"template": "feditext://__HOST_PATH__",
			"pattern": "https://([^:/\\s]+)(/(users/|@)[a-zA-Z0-9_]+.*)"
		},
		{
			"id": "com.github.Dimillian",
			"name": "Ice Cubes",
			"template": "IceCubesApp://__HOST_PATH__",
			"pattern": "https://([^:/\\s]+)(/(users/|@)[a-zA-Z0-9_]+.*)"
		},
		{
			"id": "com.tapbots",
			"name": "Ivory",
			"template": "ivory:///openURL?url=__URL_ENCODED__",
			"pattern": "https://([^:/\\s]+)(/(users/|@)[a-zA-Z0-9_]+.*)"
		},
		{
			"id": "app.getmammoth",
			"name": "Mammoth",
			"template": "mammoth://__HOST_PATH__",
			"pattern": "https://([^:/\\s]+)(/(users/|@)[a-zA-Z0-9_]+.*)"
		},
		{
			"id": "com.github.JunyuKuang",
			"name": "Mona",
			"template": "mona://__HOST_PATH__",
			"pattern": "https://([^:/\\s]+)(/(users/|@)[a-zA-Z0-9_]+.*)"
		}
	]
}
```

The following components can be used as replacements in `template`:

  * \_\_HOST\_PATH\_\_ = `mastodon.social/@chockenberry/112973783761167377`
  * \_\_PATH\_\_ = `/@chockenberry/112973783761167377`
  * \_\_URL\_ENCODED\_\_ = `https:%3A%2F%2Fmastodon.social%2F%40chockenberry%2F112973783761167377`
  * \_\_URL\_\_ = `https://mastodon.social/@chockenberry/112973783761167377`


With this URL:

> https://mastodon.social/@chockenberry/112973783761167377

If the user has chosen Ivory as a native app, the URL will be transformed using \_\_URL\_ENCODED\_\_ to:

> `ivory:///openURL?url=https:%3A%2F%2Fmastodon.social%2F%40chockenberry%2F112973783761167377`

When the a user chooses Mona, Mammoth, Ice Cubes, or Feditext, the URL will be transformed with \_\_HOST\_PATH\_\_ to:

> `mona://mastodon.social/@chockenberry/112973783761167377`

The \_\_URL\_\_ template value can be useful for apps that support [Universal Links](https://developer.apple.com/ios/universal-links/). The URL will be handled externally by the operating system and the user is presented with a choice to use an app:

```json
{
	"apps": [
		{
			"id": "com.tumblr",
			"name": "Tumblr",
			"template": "__URL__",
			"pattern": "https://([a-z0-9_]+\\.|)tumblr\\.com"
		}
	]
}
```

The `pattern` is a case-insensitive regular expression. When a link’s URL matches the pattern, the URL created by the template will be opened.

---
### discovery.json

This file helps the user find your connector when they have a URL to a page of HTML. The rules in this file will be checked and if all constraints match, the connector will be suggested to the user in an interface that simplifies set up.

The file consists of several categories: one rewrites raw user input into URLs, one specifies a list of sites where the connector can be used, and the others specify rules for the URL and content.

```json
{
	"input": [],
	"sites": [],
	"url": [],
	"nodeinfo": {},
	"html": [],
	"xml": [],
	"json": [],
	"dns": {}
}
```

The `input` and `dns` categories are checked first. `input` rewrites raw user input (like handles) into proper URLs before the main discovery flow. `dns` checks DNS records on the input's host — if it matches, the connector matches immediately without further checks.

For the remaining categories, `sites` and `url` are required checks — all must match. The `nodeinfo`, `html`, `xml`, and `json` categories are fallback checks — if any are defined, at least one must pass. If none of these categories are supplied, they have no constraints, so they are considered a match.

The following sections describe each category.

#### input

The `input` category lets a connector recognize patterns in raw user input (before it becomes a URL) and rewrite them into proper URLs for discovery. This is useful for handle-style inputs like `@user@mastodon.social` or `@user.bsky.social` that aren't valid URLs.

Each rule has two properties:

  * `match` (required): a regex pattern (in `/pattern/` syntax) that will be tested against the trimmed user input. The match is applied to the entire input string (i.e. it must match the whole input, not just a substring).
  * `url` (required): a URL template with `$1`, `$2`, etc. for capture group substitution.

If a rule matches, the rewritten URL is fed into the normal discovery pipeline (where `sites`, `url`, `html`, etc. rules take over). If there are multiple input rules, the first to match wins.

This example recognizes Mastodon-style handles like `@user@instance` or `user@instance` and rewrites them to the profile URL:

```json
	"input": [
		{
			"match": "/^@?([a-zA-Z0-9_]+)@([a-zA-Z0-9._-]+\\.[a-zA-Z]{2,})$/",
			"url": "https://$2/@$1"
		}
	]
```

With this rule, entering `@bigzaphod@mastodon.social` in the Feed Finder rewrites it to `https://mastodon.social/@bigzaphod`, which is then processed normally by the `url` and `html` rules.

This example recognizes Bluesky handles like `@user.bsky.social`:

```json
	"input": [
		{
			"match": "/^@([a-zA-Z0-9._-]+\\.[a-zA-Z]{2,})$/",
			"url": "https://bsky.app/profile/$1"
		}
	]
```

#### sites

The sites category is a list of strings where the connector can be used. These checks are performed on the URL that is supplied by the user.

For example. the `com.example` connector only works on one site so it uses:

```json
	"site": [
		"example.com"
	],
```

The YouTube connector will work on many different domains. Note that "youtube." will match "youtube.de", "youtube.fr", as well as the more familiar "youtube.com". The match does not use regular expressions.

```json
 	"site": [
 		"youtube.",
 		"youtu.be",
 		"youtubekids.com"
 	],
```

Matches are case insensitive. If a user types "YouTube.com/@iJustine", it will match the "youtube." rule above.

If the sites rules do not match, no further checks are performed and the connector is not suggested to the user.

#### url

The rules for the user’s URL consist of two parts:

  * extract (required): a regex pattern that will be used on the URL and passed to the `variable`.
  * variable (required): `site` or any variable defined in `ui-config.json` that will be set using `extract`.

If the `extract` pattern is empty it's considered a match and the full URL will be passed to the variable (this will likely be the `site`). The following example sets the `site` variable with the URL entered by the user.

```json
	"url": [
		{
			"extract": "",
			"variable": "site"
		}
	]
```

The `extract` regex pattern begins and ends with a single slash ("/") character. If no match is found, the rule fails and the connector is not offered as a suggestion. The `variable` parameter can contain a single variable name or a comma separated list.

All regular expressions are, like the web itself, case insensitive. The pattern "/foo/" will match "FOOBAR" in both the URL and HTML.

If necessary, non-capturing groups like "(?:foo|bar)" can be used in the regular expression.

This example extracts the "aww" from `http://reddit.com/r/aww/whatever` and puts it in a "subreddit" variable:

```json
	"url": [
		{
			"extract": "/reddit.com/r/([^/]+)/",
			"variable": "subreddit"
		}
	]
```

This example extracts two capture groups from `https://mastodon.social/tags/TapestryApp`. The first one sets `site` to "https://mastodon.social" and the second puts "TapestryApp" in a "tag" variable:

```json
	"url": [
		{
			"extract": "/(https://[^:/\\s]+)/tags/([a-zA-Z0-9_]+)/",
			"variable": "site, tag"
		}
	]
```

#### nodeinfo

The `nodeinfo` category identifies server software using the Fediverse-standard `/.well-known/nodeinfo` endpoint. This is the most reliable way to detect ActivityPub-compatible servers like Mastodon, Pixelfed, Lemmy, etc., since it doesn't depend on HTML content that varies between instances.

Unlike the other rule categories, `nodeinfo` is a single object — not an array. It has two optional properties, both matched case-insensitively:

  * `software` (optional): matches against the `software.name` field from the server's nodeinfo response. Examples: `"mastodon"`, `"pixelfed"`, `"lemmy"`.
  * `protocol` (optional): checks if the `protocols` array in the nodeinfo response contains this value. Example: `"activitypub"`.

If both properties are specified, both must match. If only one is specified, only that one is checked.

The nodeinfo data is only fetched when at least one connector being tested has a `nodeinfo` rule. If the fetch fails (e.g. the server doesn't support nodeinfo), the check fails silently and other fallback rules (like `html`) can still match.

This example identifies Mastodon instances regardless of their custom site name:

```json
	"nodeinfo": {
		"software": "mastodon"
	}
```

This example matches any server that supports ActivityPub:

```json
	"nodeinfo": {
		"protocol": "activitypub"
	}
```

#### html

The content at the URL provided by the user can also be checked. HTML rules operate in one of two modes:

  * **Attribute mode** (when `check` is provided): Collects all elements of a specific type, checks an attribute of those elements against `match`, and optionally extracts a value from another attribute.
  * **Content mode** (when `check` is omitted): Collects all elements of a specific type and applies `match` against the element's text content. This is useful for matching data embedded inside `<script>` tags or other elements where the relevant data is in the body text rather than an attribute.

This approach allows your connector to check things like `<link>` or `<meta>` tags as well as `<script>` tag contents. For example, a page that has the following HTML markup can be used with a connector that handles RSS feeds:

```html
<link rel="alternate" type="application/atom+xml" href="/feeds/main" />
```

The `html` rules use the following properties:

  * `element` (required): the elements in the HTML to check: "link", "meta", "script", or any other tag.
  * `check` (optional): the attribute in the element to check. If omitted, the rule operates in content mode and `match` is applied to the element's text content instead.
  * `match` (required): a string _or_ regex pattern that will be used to find matching values.
  * `use` (optional, attribute mode only): the attribute in the element that contains a value to use with the connector.
  * `extract` (optional, attribute mode only): a string _or_ regex pattern that will be used on the value specified by `use` and passed to the `variable`.
  * `transform` (optional): a template string applied as the final step before assigning to `variable`. Uses `$0` for the full match and `$1`, `$2`, etc. for capture groups from the `match` regex.
  * `variable` (optional): `site` or any variable defined in `ui-config.json` that will be set.

Both `match` and `extract` can be:

  * a string to match (e.g. "Mastodon" or "application/rss+xml")
  * a regex pattern that begins and ends with a single slash ("/") (e.g. "/example.com/([^/]+)/"

An HTML rule will fail if any of the following are true:

  * The HTML contains no `element` tags.
  * In attribute mode: the `check` attribute doesn't exist on any element, or `match` is not satisfied.
  * In content mode: no element's text content satisfies `match`.
  * If `use` is specified and no `extract` match is found.

The "href" attribute value in a `use` property will always return an absolute URL, even if there is a relative URL in the document. Variables, specifically `site`, will need a fully qualified domain name to access data since the connector has no notion of a base URL.

##### Rule evaluation

When multiple rules target **different** variables (or have no variable), they must **all** pass — this is AND logic.

When multiple rules target the **same** variable, they are treated as **alternatives** — the first rule that succeeds wins. If none succeed, the check fails. This allows a connector to define multiple strategies for discovering the same value.

##### Attribute mode examples

Get the URL for an RSS feed. Note the use of a `match` pattern with a non-capturing group that allows both the RSS and Atom formats:

```json
	"html": [
		{
			"element": "link",
			"check": "type",
			"match": "/application/(?:rss|atom)\\+xml/",
			"use": "href",
			"variable": "site"
		}
	]
```

Also note that backslashes need to be escaped because they are passed as strings to Swift's Regex framework. Forward slashes do not need to be escaped.

A simpler example just checks if there is a subscribe URL for Micro.blog without setting a variable:

```json
	"html": [
		{
			"element": "link",
			"check": "rel",
			"match": "subscribe",
			"use": "href",
			"extract": "https://micro.blog/users/follow"
		}
	]
```

Multiple rules that must all pass. The first rule below checks if there is an Open Graph `og:site_name` meta property that contains the word "Mastodon". If it does, there is another check for the `og:url` property where the `site` variable can be extracted:

```json
	"html": [
		{
			"element": "meta",
			"check": "property",
			"match": "og:site_name",
			"use": "content",
			"extract": "/.*Mastodon.*/"
		},
		{
			"element": "meta",
			"check": "property",
			"match": "og:url",
			"use": "content",
			"extract": "/(https://[^/]+)/",
			"variable": "site"
		}
	]
```

The connector for podcasts uses two rules that must both pass — the second rule has no `variable`, making it a filter that narrows the match to podcast sites specifically:

```json
		{
			"element": "link",
			"check": "type",
			"match": "application/rss+xml",
			"use": "href",
			"variable": "site"
		},
		{
			"element": "a",
			"check": "href",
			"match": "///(?:podcasts.apple.com|apple.co)//"
		}
```

The first rule checks that there is an RSS feed while the second rule checks if there is a link on the page to Apple's podcast directory.

##### Content mode example

YouTube channel pages have an RSS `<link>` tag, but watch pages do not. Instead the channel ID is embedded in a `<script>` tag's JSON. Using content mode and same-variable alternatives, both cases can be handled:

```json
	"html": [
		{
			"element": "link",
			"check": "type",
			"match": "application/rss+xml",
			"use": "href",
			"variable": "site"
		},
		{
			"element": "script",
			"match": "/\"channelId\"\\s*:\\s*\"(UC[A-Za-z0-9_-]+)\"/",
			"transform": "https://www.youtube.com/channel/$1",
			"variable": "site"
		}
	]
```

Both rules target `site`, so they are alternatives. On a channel page, the first rule matches the RSS link and the second rule is skipped. On a watch page, the first rule fails (no RSS link), so the second rule matches `"channelId"` in a script's text content and uses `transform` to build a channel URL from the captured group.

#### xml

If none of the rules above apply, the content can be checked for XML elements. There are two parameters, both of which are required. This example will identify podcast feeds:

```json
	"xml": [
		{
			"root": "rss",
			"with": "itunes:image"
		}
	]
```

The `root` element must be the first element in the content. In the example above, it guarantees that the XML data is in the RSS format.

The `with` element must occur at least once in the content. The example above checks that the RSS feed contains an iTunes image, which is required for a podcast.

#### json

If none of the rules above apply, the content can be checked for JSON keys. There are two parameters, both of which are required. This example identifies the JSON Feed format:

```json
	"json": [
		{
			"key": "version",
			"value": "https://jsonfeed.org/version/1.1"
		}
	]
```

The `key` must be a top-level key in the JSON content. The example ensures that the JSON dictionary has a `version` key with the correct `value`.

#### dns

The `dns` category checks DNS records on the host of the user's input. This is useful for protocols that use DNS records for identity verification, such as the AT Protocol (Bluesky), where custom domain handles are verified via DNS TXT records. Like `input`, `dns` is checked early — if it matches, the connector matches immediately without going through `sites`, `url`, or fallback checks. If it doesn't match (or isn't defined), the normal pipeline continues.

The `dns` rule is a single object (not an array) with the following properties:

  * `name` (required): a prefix prepended to the host to form the DNS query name. For example, `"_atproto"` queries `_atproto.example.com` when the user enters `example.com`.
  * `match` (optional): a regex pattern (in `/pattern/` syntax) tested against each TXT record value. If any record matches, the check passes. Used for boolean validation only — capture groups are ignored.
  * `extract` (optional): a regex pattern (in `/pattern/` syntax) with capture groups applied to TXT record values. Capture groups populate comma-separated names in `variable`, just like `url` rules.
  * `variable` (optional): when `extract` is present, a comma-separated list of variable names populated from capture groups. Otherwise, a single variable name set to the queried host.

If neither `match` nor `extract` is specified, the rule passes if any TXT records exist for the queried name. If the query fails or times out, the check fails silently.

If both `match` and `extract` are specified, both must pass.

This example detects AT Protocol (Bluesky) custom domain handles by checking for a `_atproto` TXT record containing a DID, and sets the `account` variable to the queried host:

```json
	"dns": {
		"name": "_atproto",
		"match": "/^did=/",
		"variable": "account"
	}
```

When a user enters `nbcnews.com`, the system queries `_atproto.nbcnews.com` for TXT records. If a record starting with `did=` is found, the connector matches and the `account` variable is set to `nbcnews.com`.

This example extracts a value from the TXT record content using a capture group:

```json
	"dns": {
		"name": "_atproto",
		"extract": "/^did=(.+)$/",
		"variable": "did"
	}
```

---
### actions.json

This file defines actions that can alter items supplied by a connector. An action is defined and referenced by `id`, however the `name` and `icon` are displayed in the Tapestry user interface. The `icon` can be any SF Symbol name or one of Tapestry's built-in symbols (listed below).

As of Tapestry 1.4, actions can also have an optional `role` that further determines where the action is rendered in the UI, assumptions about the action's return values, and how it is expected to behave. (See roles listed below.)

By default, actions are displayed as buttons on items in the timeline and/or in the item's overflow menu.

The `actions.json` file must define all possible actions, however when displaying an individual item in the timeline, only the actions attached to that item will actually be presented to the user.

Actions are displayed or preferred in the order they are defined in the `actions.json` file.

```json
{
	"items": [
		{
			"id": "favorite",
			"name": "Add Favorite",
			"icon": "heart.fill"
		},
		{
			"id": "unfavorite",
			"name": "Remove Favorite",
			"icon": "heart"
		},
		{
			"id": "thread",
			"name": "Thread",
			"icon": "bubble",
			"role": "context"
		}
	],
}
```

When returning an `Item` from `load()`, use `item.actions.add()` to add the actions that apply to it. Any extra data the actions need can be stored in `item.metadata`.

For example, an action that marks an item as a favorite might need an identifier when processing the action in `performAction`:

```javascript
	item.metadata = { id: "123456" };
	item.actions.add("favorite");
```

`metadata` is a single set of string key/value pairs shared by all of an item's actions, and can hold structured data with multiple keys:

```javascript
	item.metadata = { uri: "at:...", cid: "..." };
	item.actions.add("like");
	item.actions.add("repost");
```

When an item has one or more actions, a menu or one or more action buttons will be displayed in the app. When a user selects one, the `performAction` function is called with the action `id` and the `item`.

It is the connector’s responsibility to manage the list of actions as the state of the item changes. For example, if an action to "favorite" is performed, it would be removed from the item and replaced with an "unfavorite" action with a different icon and/or name so the user can tell that the state has changed. Use `item.actions.delete()` and `item.actions.add()` within your `performAction` implementation to do this.

The modified item is returned to Tapestry by returning it from `performAction`. If the action cannot be performed, throw an `Error` and it will be displayed to the user.

This example performs "favorite" and "unfavorite" on an item. Note that any part of the item can be modified: the body in this example, but it could be annotations or attachments as well. The example also shows how data is read from `item.metadata` and how the state of the item is managed:

```javascript

async function performAction(actionId, item, actionValue) {
	console.log(`actionId = ${actionId}`);
	if (actionId == "favorite") {
		let id = item.metadata.id;
		// (send a request to the server using `id` to favorite the item)

		let content = item.body;
		content += "<p>Faved!</p>";
		item.body = content;

		item.actions.delete("favorite");
		item.actions.add("unfavorite");
		return item;
	}
	else if (actionId == "unfavorite") {
		let id = item.metadata.id;
		// (send a request to the server using `id` to unfavorite the item)

		let content = item.body;
		content += "<p><strong>UNFAVED!</strong></p>";
		item.body = content;

		item.actions.delete("unfavorite");
		item.actions.add("favorite");
		return item;
	}
	else if (actionId == "whoops") {
		throw new Error("That wasn't supposed to happen!");
	}
}
```

> **Compatibility:** `item.metadata` and the `item.actions` `Set` require `minimum_app_version` >= 2.0. When `minimum_app_version` < 2.0, `item.actions` is a plain object and an action stores its own value directly — `item.actions = { favorite: "123456" }` — which `performAction(actionId, actionValue, item)` receives as its second argument. On >= 2.0 that value moved to the trailing `actionValue` argument purely as a compatibility hook for items a pre-2.0 version of the connector created; new connectors store data in `item.metadata` and can ignore it. Manage `item.actions` with `item.actions.add(id)` / `item.actions.delete(id)`, not by assigning to it.

#### Action Roles

The following roles are supported for actions.

By default, actions have a `null` role which means they don't get any special treatment and are generally displayed as buttons directly on the item in the timeline or, if there are too many, as options in the item's overflow menu.

**`"context"`**

A context action is expected to return additional context about the item such as a conversation thread. To display a conversation thread, for example, return an array of `Item`s from `performAction()`. The display order is preserved (Tapestry will not re-sort these items by date). It is your responsibility to return the original item in the resulting array in the position you want it to be displayed otherwise it will not be included in the resulting timeline view. Context actions appear in the swipe menu for items in the timeline and also replace the default "Details" button. (Added in Tapestry 1.4.)

**`"compose"`**

A compose action returns a [`Draft`](#draft) from `performAction()` instead of items, which opens the composer — for example, a "reply" action. See [Composing](#composing) for the full flow. (Added in Tapestry 2.0.)

#### Action Target

An optional `target` sets what an action operates on — the object Tapestry passes to `performAction` as its second argument. (Added in Tapestry 2.0.)

  * **`"item"`** — the action operates on a timeline item, which is passed to `performAction`. This is the default and can be omitted.
  * **`"draft"`** — the action operates on a [`Draft`](#draft); `performAction` receives the `Draft`. These are the composer's *submit* actions — they appear as buttons **in the composer** (added with `draft.actions.add(id)`), not on a timeline item.

A composer is usually made of **two** actions that work together — one that *opens* it and one that *submits* it — and they use different attributes, which can be confusing at first:

  * The **opening** action (`reply` below) lives on a timeline item. It uses the [`compose`](#action-roles) **role** (so returning a `Draft` opens the composer) and the default `item` target. It builds the draft and adds the submit action to it with `draft.actions.add("send")`.
  * The **submit** action (`send` below) lives in the composer, so it has no `role` (a role only matters for how an action behaves when tapped on a timeline item). What makes it a submit action is its `target: "draft"`.

```json
{
    "id": "reply",
    "name": "Reply",
    "icon": "arrow.turn.up.left",
    "role": "compose"
},
{
    "id": "send",
    "name": "Post",
    "icon": "paperplane",
    "target": "draft"
}
```

See [Composing](#composing) for the matching `performAction` implementation.

#### Action Presentation

Three optional attributes control where and how an action is presented. They are independent of `role`. (All added in Tapestry 2.0.)

**`priority`**

Either `"primary"` (the default) or `"secondary"`. Primary actions are buttons directly on the item; secondary actions go in the item's overflow (`…`) menu. If there isn't room for every primary action, the extras move to the overflow menu in their defined order.

**`group`**

A name that clusters related actions into a single button that opens a small menu — for example a "boost" and a "quote" under one affordance. A grouped action **always** opens a menu when tapped, even when it is the only action from its group currently on the item: a "boost" grouped with a "quote" that isn't applicable (an older post, or a server that doesn't support quoting) still opens a one-item menu rather than boosting immediately. This keeps the button's behavior consistent — it is always a deliberate two-tap, never a surprise one-shot — and avoids revealing whether an optional sibling like quote happens to be available. The menu is represented by the icon of its first applicable action. Grouping only applies to the buttons on the item; in the overflow menu actions are always listed individually. All actions sharing a `group` should have the same `priority`.

**`destructive`**

When `true`, the action is styled to read as destructive and asks the user to confirm before performing — use it for actions like deleting a post. A destructive action defaults to the overflow menu (as if `priority` were `"secondary"`) unless you set `priority` yourself.

#### Built-in Symbols

The following names can be used for the `icon` of an action:

tapestry.arrow.right.circle.fill
tapestry.bluesky
tapestry.bookmark.fill
tapestry.bookmark
tapestry.boost.fill
tapestry.boost
tapestry.counter.arrow
tapestry.crosstalk
tapestry.hashtag
tapestry.jump.back
tapestry.jump.to.marker
tapestry.jump.to.top
tapestry.mark.fill
tapestry.mark
tapestry.mastodon
tapestry.microblog
tapestry.muffled
tapestry.open.original
tapestry.person.2
tapestry.person
tapestry.reddit
tapestry.sparkles.premium
tapestry.star.fill
tapestry.star
tapestry.timeline.collapsed
tapestry.timeline.expanded
tapestry.timeline.mini
tapestry.tumblr
tapestry.view.details
tapestry.youtube

---
## HTML Content

### How Tapestry uses HTML

Tapestry's `Item` object uses HTML as its native content type. The `body` property will be used in two ways:

  1. To preview the post in the main timeline. A limited number of words (100-200) in the content will be displayed as formatted text. HTML tags can be used to influence this formatting (e.g. `<strong>` making bold text). Any content that won’t fit in the available space will end with "More…".
  2. The post’s detail view will display the full HTML content with styling provided by Tapestry’s current theme (e.g. dark vs. light). This content will be displayed as a web view.

Some HTML tags won’t appear in the preview. Things like `<table>`, `<ul>`, or `<hr/>` will only appear in the detail view. Our hope is that for most use cases, this will be fine. It’s rare to begin HTML with these kinds of tags, so previewing them is unnecessary. Additionally, the detail view will use a full WebKit rendering engine, so it can display any content not in the preview.

### HTML Preview Tags

In the first case, speed is of the essence. Timeline scrolling peformance can only be achieved with a subset of HTML that is converted to formatted text. In this context, think of your content text more like Markdown formatting than full HTML formatting.

The following tags are supported:

  * `<p>` to start a paragraph.
  * `<strong>, <b>` for **strongly emphasized** text.
  * `<em>, <i>` for _emphasized_ text.
  * `<strike>, <s>` for ~~strikethrough~~ text.
  * `<a>` for [linked](https://example.com) text.
  * `<img>` for inline attachments (see below).
  * `<blockquote>` for quoted text.
  * `<br>` for a newline in the context of a paragraph. Ignored outside a paragraph.

For example, if your connector provides the following `body`:

```html
<p><b>Bold</b>, <i>italic</i>, <b><i>both</i></b>,<br/> and <a href="#">link</a>.</p>
```

Tapestry will render a preview and detail view like this:


> **Bold**, _italic_, **_both_**,<br/>
> and [link](#).

As with all HTML, unclosed tags will provide unpredictable results. Close your tags.

### HTML Inline Attachments

Some attachments are easier to deal with as inline content. For example, a blog feed may contain several `<img>` tags that you want to see as images in the timeline.

As a part of the step to create the timeline preview, images can automatically be extracted from the HTML content and assigned as `MediaAttachment` objects.

For example, if your connector provides this content:
```
<p>In this blog post, I will explain our watermark.</p>
<p><img src="https://iconfactory.com/images-v8/if_watermark.png"/></p>
```

If no media attachments have been added to an item, Tapestry will create them automatically from inline images and show this in the media viewer:

<img width="46" height="46" src="https://iconfactory.com/images-v8/if_watermark.png"/>

If the `<img>` tag includes an `alt` attribute, that text will be included in the attachment and used to improve accessibility in the timeline.

A `LinkAttachment` can also be created automatically. Tapestry will check the first link in the first paragraph and show the preview card in the timeline if the link contains Open Graph information.

<table>
	<tr>
		<th>State</th>
		<th>Behavior</th>
	</tr>
	<tr>
		<td>True</td>
		<td>Good</td>
	</tr>
</table>
	
This behavior can be disabled with `"provides_attachments": true` in `plugin-config.json`. The Mastodon connector is an example of where this is used because its API provides attachments directly in the payload.

