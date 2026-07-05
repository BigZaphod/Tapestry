
// social.bsky - shared

const uriPrefix = "https://bsky.app";
const uriPrefixContent = "https://cdn.bsky.app";
const uriPrefixVideo = "https://video.bsky.app";

async function getSessionDid() {
	const text = await sendRequest(site + "/xrpc/com.atproto.server.getSession");
	const jsonObject = JSON.parse(text);
	const did = jsonObject.did;
	return did;
}

async function getAccountDid(account) {
	const text = await sendRequest(`${site}/xrpc/app.bsky.actor.getProfile?actor=${account}`)
	const jsonObject = JSON.parse(text);	
	const did = jsonObject.did;
	return did;
}

async function getFeedInfo(did, feedId) {
	const text = await sendRequest(`${site}/xrpc/app.bsky.feed.getFeedGenerator?feed=at://${did}/app.bsky.feed.generator/${feedId}`)
	const jsonObject = JSON.parse(text);	
	const feedName = jsonObject.view.displayName;
	const avatar = jsonObject.view.avatar;
	return [feedName, avatar];
}

function normalizeAccount(account) {
	let result = account.trim();
	if (result.length > 1 && result.startsWith("@")) {
		result = result.slice(1);
	}
	return result;
}

function parentsForItem(item, includeActions) {
	let results = [];
	if (item.parent != null) {
		parentPostForItem(item.parent, includeActions, results);
	}
	return results;
}

function parentPostForItem(item, includeActions, results) {
	if (item.parent != null) {
		parentPostForItem(item.parent, includeActions, results);
	}

	const post = postForItem(item, includeActions);
	if (post != null) {
		results.push(post);
	}
}

function postForItem(item, includeActions = false, dateOverride = null, allowRepliesFromOthers = true) {
    let date = dateOverride ?? (new Date(item.post.indexedAt));

    const author = item.post.author;
    
    const identity = identityForAccount(author);
    
    const inReplyToRecord = item.reply && item.reply.record
    const reason = item.reason
    const record = item.post.record;
    
    if (item.reply != null) {
    	if (! allowRepliesFromOthers) {
			if (item.reply.parent?.author?.viewer.following == null) {
				return null;
			}
		}
	}
            
    let content = contentForRecord(item.post.record);
        
    let metadata = { uri: item.post.uri, cid: item.post.cid };
    // Capture the thread root so a reply can set both `parent` (this post) and `root`. A top-level post is its own
    // root; a reply's root comes from the feed item's reply ref (fall back to this post if it's missing/blocked).
    const replyRoot = item.reply?.root;
    if (replyRoot?.uri != null && replyRoot?.cid != null) {
        metadata.rootUri = replyRoot.uri;
        metadata.rootCid = replyRoot.cid;
    } else {
        metadata.rootUri = item.post.uri;
        metadata.rootCid = item.post.cid;
    }
    // Carry the post's primary language so a reply can prefill it (the server won't inherit it).
    if (item.post.record?.langs?.[0] != null) { metadata.language = item.post.record.langs[0]; }
    let actions = [];
    if (includeActions) {
        actions.push("reply");
        if (item.post.viewer?.like != null) {
            metadata.likeRkey = item.post.viewer.like.split("/").pop();
            actions.push("unlike");
        }
        else {
            actions.push("like");
        }
        if (item.post.viewer?.repost != null) {
            metadata.repostRkey = item.post.viewer.repost.split("/").pop();
            actions.push("unrepost");
        }
        else {
            actions.push("repost");
        }
        // Bluesky always supports quoting (the target post's own postgate may still reject it — the server enforces
        // that at send, surfaced as an error). Grouped with repost/unrepost so they share one cell button.
        actions.push("quote");
        if (item.post.viewer?.bookmarked != null) {
            actions.push(item.post.viewer?.bookmarked == false ? "save" : "unsave");
        }
        // Only your own posts can be deleted. "didSelf" is the authenticated account's DID, stored at login.
        const didSelf = getItem("didSelf");
        if (didSelf != null && author.did == didSelf) {
            actions.push("delete");
        }
    }
    actions.push(item.post?.replyCount > 0 ? "replies" : "thread");

    let contentWarning = null;
    if (item.post.labels != null && item.post.labels.length > 0) {
        const labels = item.post.labels.map((label) => { return label?.val ?? "" }).join(", ");
        contentWarning = `Labeled: ${labels}`;
    }
    
    let annotation = null;
    
    let replyContent = null;
    if (item.reply != null) {
        annotation = annotationForReply(item);
		if (item.post.author.handle != item.reply.parent?.author?.handle) {					
			replyContent = contentForReply(item.reply);
			if (replyContent != null) {
				content = replyContent + content;
			}
		}
	}
	
    const repostContent = contentForRepost(item.reason);
    if (repostContent != null) {
        if (item.reason.indexedAt != null) {
            date = new Date(item.reason.indexedAt);
        }
        annotation = annotationForRepost(item.reason);
        content = repostContent + content;
    }

    let showItem = true;
    if (includeReposts != "on") {
        if (repostContent != null) {
            showItem = false;
        }
    }
    if (includeReplies != "on") {
        if (replyContent != null && repostContent == null) { // show replies only if they are not reposted
            showItem = false;
        }
    }
    if (includeQuotes != "on") {
        if (item.post.embed?.$type?.startsWith("app.bsky.embed.record")) {
            showItem = false;
        }
    }

    if (showItem) {
        let attachments = attachmentsForEmbed(item.post.embed);
                
        const itemIdentifier = item.post.uri.split("/").pop();
        const postUri = uriPrefix + "/profile/" + author.handle + "/post/" + itemIdentifier;
        
        const post = Item.createWithUriDate(postUri, date);
        post.body = content;
        post.author = identity;
        post.metadata = metadata;
        for (const action of actions) {
            post.actions.add(action);
        }
        if (attachments != null) {
            post.attachments = attachments
        }
        if (annotation != null) {
            post.annotations = [annotation];
        }
        if (contentWarning != null) {
            post.contentWarning = contentWarning;
        }
        
        return post;
    }
    
    return null;
}

function postForEmbeddedRecord(record) {
    if (record == null || record.author?.handle == null) {
        return null;
    }

    const date = new Date(record.indexedAt);
    const identity = identityForAccount(record.author);
    const content = contentForRecord(record.value);
    const attachments = attachmentsForEmbed(record.embeds?.[0]);

    const itemIdentifier = record.uri.split("/").pop();
    const postUri = uriPrefix + "/profile/" + record.author.handle + "/post/" + itemIdentifier;

    const post = Item.createWithUriDate(postUri, date);
    post.body = content;
    post.author = identity;
    if (attachments != null) {
        post.attachments = attachments;
    }
    if (record.labels != null && record.labels.length > 0) {
        const labels = record.labels.map((label) => { return label?.val ?? "" }).join(", ");
        post.contentWarning = `Labeled: ${labels}`;
    }

    return post;
}

function identityForAccount(account) {
    const name = nameForAccount(account);
    if (name == null) {
        return null;
    }
    
    const authorUri = uriPrefix + "/profile/" + account.handle;
    const identity = Identity.createWithName(name);
    identity.username = "@" + account.handle;
    identity.uri = authorUri;
    if (account.avatar != null) {
        identity.avatar = account.avatar;
    }
    
    return identity;
}

function contentForAccount(account, prefix = "") {
    const name = nameForAccount(account);
    if (name == null) {
        return "";
    }

    const authorUri = uriPrefix + "/profile/" + account.handle;
    
    return `<p>${prefix}<a href="${authorUri}">${name}</a></p>`;
}

function nameForAccount(account) {
    if (account == null || account.handle == null) {
        return null;
    }

	const did = getItem("didSelf");
	if (did != null && did == account.did) {
		return "you";
	}
	
    if (account.displayName != null && account.displayName.length > 0) {
        return account.displayName;
    }
    else {
        return account.handle;
    }
}

function handleForAccount(account) {
    if (account == null || account.handle == null) {
        return null;
    }

    return "@" + account.handle;
}

function uriForAccount(account) {
    if (account == null || account.handle == null) {
        return null;
    }

    return uriPrefix + "/profile/" + account.handle;

}

function annotationForRepost(reason) {
    let annotation = null;

    if (reason != null && reason.$type == "app.bsky.feed.defs#reasonRepost") {
        let name = nameForAccount(reason.by);
        if (name != null) {
            const text = `Reposted by ${name}`;
            annotation = Annotation.createWithText(text);
            annotation.uri = uriForAccount(reason.by);
        }
    }
    
    return annotation;
}

function contentForRepost(reason) {
    let content = null;

    if (reason != null && reason.$type == "app.bsky.feed.defs#reasonRepost") {
        content = "";
    }
    
    return content;
}

function annotationForReply(item) {
    let annotation = null;

    if (item.reply != null && item.reply.parent != null) {
    	if (item.post.author.handle == item.reply.parent.author?.handle) {
			const text = "Replying to self";
			annotation = Annotation.createWithText(text);
			annotation.uri = uriForAccount(item.post.author);
    	}
    	else {
			let name = nameForAccount(item.reply.parent.author);
			if (name != null) {
				const text = `In reply to ${name}`;
				annotation = Annotation.createWithText(text);
				annotation.uri = uriForAccount(item.reply.parent.author);
			}
        }
    }
    
    return annotation;
}

function contentForReply(reply) {
    let content = null;

    if (reply != null && reply.parent != null) {
        const replyContent = contentForRecord(reply.parent.record);
        const replyName = nameForAccount(reply.parent.author);
        if (replyName != null) {
            content = `<blockquote><p>${replyName} said:</p><p>${replyContent}</p></blockquote>`;
        }
        else {
            content = `<blockquote><p>${replyContent}</p></blockquote>`;
        }
    }
    
    return content;
}

function attachmentsForEmbed(embed, did = null) {
    let attachments = null;
    
    if (embed != null) {
        if (embed.$type.startsWith("app.bsky.embed.images")) {
            const images = embed.images;
            if (images != null) {
                attachments = []
                let count = images.length;
                for (let index = 0; index < count; index++) {
                    let image = images[index];
                    const isBlob = (image.image?.$type == "blob");
                    let media = null;
                    if (isBlob) {
                        if (did != null && image.image?.ref?.$link != null) {
                            const ref = image.image.ref.$link;
                            const suffix = image.image.mimeType?.split("/")[1] ?? "";
                            media = `${uriPrefixContent}/img/feed_fullsize/plain/${did}/${ref}@${suffix}`;
                        }
                    }
                    else {
                        media = image.fullsize;
                    }
                    if (media != null) {
                        const attachment = MediaAttachment.createWithUrl(media);
                        if (image.aspectRatio != null) {
                            attachment.aspectSize = image.aspectRatio;
                        }
                        if (image.alt != null && image.alt.length != 0) {
                            attachment.text = image.alt;
                        }
                        if (isBlob) {
                            if (did != null && image.image?.ref?.$link != null) {
                                const ref = image.image.ref.$link;
                                const suffix = image.image.mimeType?.split("/")[1] ?? "";
                                attachment.thumbnail = `${uriPrefixContent}/img/feed_thumbnail/plain/${did}/${ref}@${suffix}`;
                            }
                        }
                        else {
                            if (image.thumb) {
                                attachment.thumbnail = image.thumb;
                            }
                        }
                        attachment.mimeType = "image";
                        attachments.push(attachment);
                    }
                }
            }
        }
        else if (embed.$type.startsWith("app.bsky.embed.video")) {
            const isBlob = (embed.video?.$type == "blob");
            if (isBlob) {
                if (did != null && embed.video?.ref?.$link != null) {
                    const ref = embed.video?.ref?.$link;
                    const media = `${uriPrefixVideo}/watch/${did}/${ref}/playlist.m3u8`;
                    const thumbnail = `${uriPrefixVideo}/watch/${did}/${ref}/thumbnail.jpg`;
                    const attachment = MediaAttachment.createWithUrl(media);
                    if (embed.aspectRatio != null) {
                        attachment.aspectSize = embed.aspectRatio;
                    }
                    if (embed.alt != null && embed.alt.length != 0) {
                        attachment.text = embed.alt;
                    }
                    attachment.thumbnail = thumbnail;
                    attachment.mimeType = "video/mp4";
                    attachments = [attachment];
                }
            }
            else {
                if (embed.playlist != null) {
                    const media = embed.playlist;
                    const attachment = MediaAttachment.createWithUrl(media);
                    if (embed.aspectRatio != null) {
                        attachment.aspectSize = embed.aspectRatio;
                    }
                    if (embed.alt != null && embed.alt.length != 0) {
                        attachment.text = embed.alt;
                    }
                    if (embed.thumbnail != null) {
                        attachment.thumbnail = embed.thumbnail;
                    }
                    attachment.mimeType = "video/mp4";
                    attachments = [attachment];
                }
            }
        }
        else if (embed.$type.startsWith("app.bsky.embed.external")) {
            if (embed.external != null && embed.external.uri != null) {
                const isBlob = (embed.external?.thumb?.$type == "blob");
                
                const external = embed.external;
                let attachment = LinkAttachment.createWithUrl(external.uri);
                if (external.title != null && external.title.length > 0) {
                    attachment.title = external.title;
                }
                if (external.description != null && external.description.length > 0) {
                    attachment.subtitle = external.description;
                }
                if (isBlob) {
                    if (did != null && embed.external?.thumb?.ref?.$link != null) {
                        const ref = embed.external?.thumb?.ref?.$link;
                        const suffix = embed.external?.thumb?.mimeType.split("/")[1] ?? "";
                        attachment.image = `${uriPrefixContent}/img/feed_thumbnail/plain/${did}/${ref}@${suffix}`;
                    }
                }
                else {
                    if (external.thumb != null && external.thumb.length > 0) {
                        attachment.image = external.thumb;
                    }
                }
                attachments = [attachment];
            }
        }
        else if (embed.$type.startsWith("app.bsky.embed.recordWithMedia")) {
            if (embed.record != null && embed.media != null) {
                attachments = attachmentsForEmbed(embed.media);

                const attachment = postForEmbeddedRecord(embed.record.record);
                if (attachment != null) {
                    if (attachments == null) {
                        attachments = [attachment];
                    }
                    else {
                        attachments.push(attachment);
                    }
                }
            }
        }
        else if (embed.$type.startsWith("app.bsky.embed.record")) { // NOTE: This one needs to be after app.bsky.embed.recordWithMedia because of the lazy match
            const attachment = postForEmbeddedRecord(embed.record);
            if (attachment != null) {
                attachments = [attachment];
            }
        }

    }
    
    return attachments;
}

function contentForRecord(record) {
    if (record == null) {
        return "<p>Deleted post</p>";
    }
    // TODO: This logic is fragile...
    if (record.text == null && record?.value == null) { //record?.value.text == null) {
        return "";
    }
    
    let content = record.text ?? record.value.text;
    
    // NOTE: Facets are a pain in the butt since they use byte positions in UTF-8. The JSON parser generates UTF-16
    // so we have to convert it back to bytes, find what we need, and then make a new UTF-16 string.
    
    try {
        content = content.replaceAll("<", "\x02"); // replace less-than with SOT (Start Of Text) ASCII code
        content = content.replaceAll(">", "\x03"); // replace greater-than with EOT (End Of Text) ASCII code

        if (record.facets != null) {
            // NOTE: Facets are processed in reverse order determined by the starting index. This is because the output string
            // is being modified in place.
            const sortedFacets = record.facets.toSorted((a,b) => {return b?.index?.byteStart - a?.index?.byteStart})
            for (const facet of sortedFacets) {
                if (facet.features.length > 0) {
                    const bytes = new TextEncoder().encode(content);
                    
                    const prefixBytes = bytes.slice(0, facet.index.byteStart);
                    const suffixBytes = bytes.slice(facet.index.byteEnd);
                    const textBytes = bytes.slice(facet.index.byteStart, facet.index.byteEnd);
    
                    const decoder = new TextDecoder();
                    const prefix = decoder.decode(prefixBytes);
                    const suffix = decoder.decode(suffixBytes);
                    const text = decoder.decode(textBytes);
    
                    const feature = facet.features[0];
    
                    if (feature.$type == "app.bsky.richtext.facet#link") {
                        const link = `<a href="${feature.uri}">${text}</a>`;
                        content = prefix + link + suffix;
                    }
                    else if (feature.$type == "app.bsky.richtext.facet#mention") {
                        const link = `<a href="${uriPrefix}/profile/${feature.did}">${text}</a>`;
                        content = prefix + link + suffix;
                    }
                    else if (feature.$type == "app.bsky.richtext.facet#tag") {
                        //console.log(`tag feature = ${JSON.stringify(feature)}`);
                        const link = `<a href="${uriPrefix}/hashtag/${feature.tag}">${text}</a>`;
                        content = prefix + link + suffix;
                    }
                    else {
                        console.log(`skipped feature.$type = ${feature.$type}`);
                    }
                }
            }
        }
    }
    catch (error) {
        console.log(`facet conversion error = ${error}`);
    }

    let finalContent = "";
    const paragraphs = content.split("\n\n")
    for (const paragraph of paragraphs) {
        finalContent += "<p>" + paragraph.replaceAll("\n", "<br/>") + "</p>";
    }
    finalContent = finalContent.replaceAll("\x02", "&lt;"); // replace SOT (Start Of Text) ASCII code with less-than HTML entity
    finalContent = finalContent.replaceAll( "\x03", "&gt;"); // replace EOT (End Of Text) ASCII code with greater-than HTML entity

    return finalContent;
}

// By being in bluesky-shared.js, all of the Bluesky connectors get this.
// However, most actions will not work unless authenticated! So be sure to
// edit the actions.json file for each connector and only include the ones
// that can actually work for the non-authorized connector variants!
// A TID (timestamp identifier) — the AT-Protocol record-key format: a sortable, 13-char base32 encoding of a
// microsecond timestamp (53 bits) plus a random 10-bit clock id. `app.bsky.feed.post` requires the rkey to be a
// TID. We choose it client-side so a resubmit reuses the same rkey and `createRecord` rejects the duplicate
// (Bluesky has no idempotency header).
const _s32 = "234567abcdefghijklmnopqrstuvwxyz";
let _tidLast = 0n;
const _tidClock = BigInt(Math.floor(Math.random() * 1024));
function nextTid() {
	let micros = BigInt(Date.now()) * 1000n;
	if (micros <= _tidLast) { micros = _tidLast + 1n; }
	_tidLast = micros;
	let n = (micros << 10n) | _tidClock;
	let s = "";
	for (let i = 0; i < 13; i++) { s = _s32[Number(n & 31n)] + s; n >>= 5n; }
	return s;
}

// Resolve a handle (e.g. "alice.bsky.social") to its DID, or null if it can't be resolved.
async function resolveHandle(handle) {
	try {
		const text = await sendRequest(`${site}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
		return JSON.parse(text).did;
	} catch (error) {
		return null;
	}
}

// Build richtext facets for the @mentions and links in `text`. Offsets are UTF-8 BYTE positions (byteEnd
// exclusive), computed over the exact string sent as record.text. A mention that can't be resolved to a DID is
// left as plain text rather than blocking the post.
async function buildFacets(text) {
	const encoder = new TextEncoder();
	const byteLength = (s) => encoder.encode(s).length;
	const facets = [];

	// Mentions: @handle. atproto handles are a-z 0-9 . - (no underscore); a trailing dot isn't part of the handle.
	for (const match of text.matchAll(/(^|\s|\()@([a-zA-Z0-9.-]+)/g)) {
		const handle = match[2].replace(/\.+$/, "");
		if (handle.length === 0) { continue; }
		const did = await resolveHandle(handle);
		if (did == null) { continue; }
		const start = byteLength(text.slice(0, match.index + match[1].length));
		const end = start + byteLength("@" + handle);
		facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ "$type": "app.bsky.richtext.facet#mention", did: did }] });
	}

	// Links: http(s) URLs. Strip trailing punctuation (and an unmatched closing paren) the greedy match grabs.
	for (const match of text.matchAll(/(^|\s|\()(https?:\/\/[^\s]+)/g)) {
		let url = match[2].replace(/[.,;:!?]+$/, "");
		if (url.endsWith(")") && !url.includes("(")) { url = url.slice(0, -1); }
		const start = byteLength(text.slice(0, match.index + match[1].length));
		const end = start + byteLength(url);
		facets.push({ index: { byteStart: start, byteEnd: end }, features: [{ "$type": "app.bsky.richtext.facet#link", uri: url }] });
	}

	return facets;
}

// Build a fresh compose draft. `reply` seeds the reply refs (root + parent) for threading and the post to display;
// no mention prefill — a Bluesky reply notifies the parent via the ref (matching the official client), and any
// @-mention the user types becomes a facet at send. `newPost` starts blank. Both carry a client-chosen `rkey` for
// idempotency and submit through the same `send` verb.
function composeDraft(actionId, target, metadata) {
	const draft = Draft.create();
	draft.metadata = { rkey: nextTid() };
	draft.actions.add("send");

	// Bluesky posts are limited to BOTH 300 graphemes and 3000 UTF-8 bytes (the `app.bsky.feed.post` lexicon caps
	// text at maxGraphemes:300 / maxLength:3000). The byte cap can bind first on emoji-heavy text. No weighting:
	// URLs and mentions count as their literal typed length — we post the text verbatim, matching what the server
	// counts (unlike the official app, which shortens URLs in its own counter and so disagrees with the server).
	draft.rules = {
		characterUnit: "graphemes",
		characterCounter: { fields: ["body"], characterLimit: { maxLength: 300, maxBytes: 3000 } },
		fields: { body: { placeholder: actionId == "reply" ? "Write your reply" : "What's up?" } },
		attributes: composeAttributes(actionId == "reply")
	};

	if (actionId == "reply") {
		const author = target.author;
		draft.header = "Reply to " + (author?.name ?? author?.username ?? "post");
		draft.context = [target];
		draft.metadata.parentUri = metadata.uri;
		draft.metadata.parentCid = metadata.cid;
		draft.metadata.rootUri = metadata.rootUri ?? metadata.uri;
		draft.metadata.rootCid = metadata.rootCid ?? metadata.cid;
		if (metadata.language != null) { draft.attributeValues.language = metadata.language; }
	} else if (actionId == "quote") {
		// A quote is a top-level post embedding another. The full item rides `attachments` for the composer preview
		// (and to keep it live); the strong ref used to build the embed at send rides `metadata`, like a reply ref.
		const author = target.author;
		draft.header = "Quote " + (author?.name ?? author?.username ?? "post");
		draft.attachments = [target];
		draft.metadata.quoteUri = metadata.uri;
		draft.metadata.quoteCid = metadata.cid;
	} else {
		draft.header = "New Post";
	}

	return draft;
}

// Bluesky's composer settings: who may reply (threadgate), whether the post can be quoted (postgate), and the post
// language. Reply audience is one multi-select mirroring Bluesky's own model — "Everybody" (no threadgate) and
// "Nobody" (empty allow list) are mutually exclusive with each other and with the relationship groups, which combine.
// It's written as a threadgate sidecar at `send`. Quotes are allowed by default; turning that off writes a postgate.
//
// A threadgate is structurally root-only in atproto (its rkey must equal the thread root's), so reply audience can't
// be set on a reply — that attribute is offered only on top-level posts.
function composeAttributes(isReply) {
	const attributes = [];
	if (!isReply) {
		attributes.push({
			name: "replyAudience",
			prompt: "Who can reply",
			type: "multiple",
			defaultValue: "everybody",
			requireSelection: true,
			icon: "bubble.left.and.bubble.right",
			description: "Everybody can reply by default. Choose “Nobody”, or combine groups to limit who can reply.",
			choices: [
				{ value: "everybody", prompt: "Everybody", exclusive: true },
				{ value: "nobody", prompt: "Nobody", exclusive: true },
				{ value: "mentioned", prompt: "Mentioned users" },
				{ value: "following", prompt: "People you follow" },
				{ value: "followers", prompt: "Your followers" }
			]
		});
	}
	attributes.push({
		name: "allowQuotes",
		prompt: "Who can quote",
		defaultValue: "on",
		choices: [
			{ value: "on", prompt: "Anyone", icon: "quote.bubble" },
			{ value: "off", prompt: "Nobody", icon: "nosign" }
		]
	});
	attributes.push({ name: "language", type: "language" });
	return attributes;
}

// Reply/quote controls are written as sidecar records sharing the post's rkey (Bluesky has no atomic multi-write).
// Best-effort: the post already exists, so a gate failure is logged rather than fatal — surfacing partial failure to
// the user is a later refinement.
async function writeGates(attributes, did, postUri, rkey, createdAt, isReply) {
	const extraHeaders = { "content-type": "application/json" };
	const createGate = async (collection, record) => {
		try {
			const gateBody = { collection: collection, repo: did, rkey: rkey, record: record };
			await sendRequest(`${site}/xrpc/com.atproto.repo.createRecord`, "POST", JSON.stringify(gateBody), extraHeaders);
		} catch (error) {
			console.log(`${collection} failed (the post is still up): ${error}`);
		}
	};

	// Threadgate — only on a top-level post (a threadgate's rkey must equal the thread root's, so a reply can't carry
	// one) and only when replies aren't open to everyone. An empty allow list means "nobody", which is exactly what
	// the "nobody" selection (and any selection lacking a relationship rule) produces.
	const audience = new Set((attributes.replyAudience ?? "everybody").split(","));
	if (!isReply && !audience.has("everybody")) {
		const allow = [];
		if (audience.has("following")) { allow.push({ "$type": "app.bsky.feed.threadgate#followingRule" }); }
		if (audience.has("followers")) { allow.push({ "$type": "app.bsky.feed.threadgate#followerRule" }); }
		if (audience.has("mentioned")) { allow.push({ "$type": "app.bsky.feed.threadgate#mentionRule" }); }
		await createGate("app.bsky.feed.threadgate", { "$type": "app.bsky.feed.threadgate", post: postUri, allow: allow, createdAt: createdAt });
	}

	// Postgate — only when quotes are disallowed.
	if (attributes.allowQuotes === "off") {
		await createGate("app.bsky.feed.postgate", { "$type": "app.bsky.feed.postgate", post: postUri, createdAt: createdAt, embeddingRules: [{ "$type": "app.bsky.feed.postgate#disableRule" }] });
	}
}

async function performAction(actionId, target, actionValue) {
	// 2.0 stores the post's uri/cid/rkey in item.metadata; older items stored
	// them as a JSON string under the action's value. Fall back for those.
	// Removable a few months after 2.0 ships publicly, once pre-2.0 items have
	// expired out of catalogs.
	// `target` is null for a feed-targeted action (newPost) — the `?.` keeps that from throwing here.
	let metadata = target?.metadata;
	if (metadata == null) {
		const legacy = actionValue;
		if (legacy != null) {
			const values = JSON.parse(legacy);
			metadata = { uri: values.uri, cid: values.cid };
			// The old unlike/unrepost actions carried the record's rkey directly.
			if (actionId == "unlike") { metadata.likeRkey = values.rkey; }
			else if (actionId == "unrepost") { metadata.repostRkey = values.rkey; }
		}
	}

	let did = getItem("did");
	if (did == null) {
		did = await getSessionDid();
		setItem("did", did);
	}

	let date = new Date().toISOString();
	if (actionId == "like") {
		const body = {
			collection: "app.bsky.feed.like",
			repo: did,
			record : {
				"$type": "app.bsky.feed.like",
				subject: {
					uri: metadata.uri,
					cid: metadata.cid
				},
				createdAt: date,
			}
		};

		const url = `${site}/xrpc/com.atproto.repo.createRecord`;
		const parameters = JSON.stringify(body);
		const extraHeaders = { "content-type": "application/json" };
		const text = await sendRequest(url, "POST", parameters, extraHeaders);
		const jsonObject = JSON.parse(text);
		const rkey = jsonObject.uri.split("/").pop();

		metadata.likeRkey = rkey;
		target.metadata = metadata;
		target.actions.delete("like");
		target.actions.add("unlike");
		return target;
	}
	else if (actionId == "unlike") {
		const body = {
			collection: "app.bsky.feed.like",
			repo: did,
			rkey: metadata.likeRkey
		};

		const url = `${site}/xrpc/com.atproto.repo.deleteRecord`;
		const parameters = JSON.stringify(body);
		const extraHeaders = { "content-type": "application/json" };
		const text = await sendRequest(url, "POST", parameters, extraHeaders);
		const jsonObject = JSON.parse(text);

		target.actions.delete("unlike");
		target.actions.add("like");
		return target;
	}
	else if (actionId == "repost") {
		const body = {
			collection: "app.bsky.feed.repost",
			repo: did,
			record : {
				"$type": "app.bsky.feed.repost",
				subject: {
					uri: metadata.uri,
					cid: metadata.cid
				},
				createdAt: date,
			}
		};

		const url = `${site}/xrpc/com.atproto.repo.createRecord`;
		const parameters = JSON.stringify(body);
		const extraHeaders = { "content-type": "application/json" };
		const text = await sendRequest(url, "POST", parameters, extraHeaders);
		const jsonObject = JSON.parse(text);
		const rkey = jsonObject.uri.split("/").pop();

		metadata.repostRkey = rkey;
		target.metadata = metadata;
		target.actions.delete("repost");
		target.actions.add("unrepost");
		return target;
	}
	else if (actionId == "unrepost") {
		const body = {
			collection: "app.bsky.feed.repost",
			repo: did,
			rkey: metadata.repostRkey
		};

		const url = `${site}/xrpc/com.atproto.repo.deleteRecord`;
		const parameters = JSON.stringify(body);
		const extraHeaders = { "content-type": "application/json" };
		const text = await sendRequest(url, "POST", parameters, extraHeaders);
		const jsonObject = JSON.parse(text);

		target.actions.delete("unrepost");
		target.actions.add("repost");
		return target;
	}
	else if (actionId == "save") {
		const body = {
			uri: metadata.uri,
			cid: metadata.cid
		};

		const url = `${site}/xrpc/app.bsky.bookmark.createBookmark`;
		const parameters = JSON.stringify(body);
		const extraHeaders = { "content-type": "application/json" };
		const text = await sendRequest(url, "POST", parameters, extraHeaders);

		target.actions.delete("save");
		target.actions.add("unsave");
		return target;
	}
	else if (actionId == "unsave") {
		const body = {
			uri: metadata.uri
		};

		const url = `${site}/xrpc/app.bsky.bookmark.deleteBookmark`;
		const parameters = JSON.stringify(body);
		const extraHeaders = { "content-type": "application/json" };
		const text = await sendRequest(url, "POST", parameters, extraHeaders);

		target.actions.delete("unsave");
		target.actions.add("save");
		return target;
	}
	else if (actionId == "thread" || actionId == "replies") {
		const uri = metadata.uri;
		const response = await sendRequest(`${site}/xrpc/app.bsky.feed.getPostThread?uri=${uri}`);
		const json = JSON.parse(response);
		const firstItem = json["thread"];

		let results = [];
		let parents = parentsForItem(firstItem, true);
		results.push(...parents);

		// NOTE: This is a workaround for a problem with the media attachments on Bluesky. The paths for videos end
		// in .m3u8, which is a container format that can contain audio or video. This connector explicitly sets the
		// MIME type to video/mp4, but that's converted to a .movie UTType internally by Tapestry. The item that's provided
		// to this action gets a MIME type that's generated from the path extension, and that's returned as audio. The
		// result is that the videos no longer play.
		//
		// To fix this, we create a new post for the item returned by the API, and patch the attachments (preserving other
		// attributes like annotations and dates).
		const patchPost = postForItem(firstItem, true);
		target.attachments = patchPost.attachments;
		results.push(target);

		for (const reply of firstItem.replies) {
			results.push(postForItem(reply, true));
		}
		return results;
	}
	else if (actionId == "delete") {
		// The post's rkey is the last path component of its at:// uri; the repo is your own DID (you can only
		// delete your own posts).
		const body = {
			collection: "app.bsky.feed.post",
			repo: did,
			rkey: metadata.uri.split("/").pop()
		};
		const url = `${site}/xrpc/com.atproto.repo.deleteRecord`;
		const parameters = JSON.stringify(body);
		const extraHeaders = { "content-type": "application/json" };
		await sendRequest(url, "POST", parameters, extraHeaders);
		return [Item.delete(target.uri)];
	}
	else if (actionId == "reply" || actionId == "newPost" || actionId == "quote") {
		return composeDraft(actionId, target, metadata);
	}
	else if (actionId == "send") {
		// Here `target` is the DRAFT. Create the post; the reply threads on the server and the timeline/thread
		// reconciles on the next refresh (nothing to return — createRecord only yields {uri, cid}).
		const draft = target;
		const attributes = draft.attributeValues ?? {};
		const createdAt = new Date().toISOString();
		const record = {
			"$type": "app.bsky.feed.post",
			text: draft.body,
			createdAt: createdAt,
		};
		if (attributes.language != null) { record.langs = [attributes.language]; }
		if (draft.metadata.parentUri != null) {
			record.reply = {
				root: { uri: draft.metadata.rootUri, cid: draft.metadata.rootCid },
				parent: { uri: draft.metadata.parentUri, cid: draft.metadata.parentCid },
			};
		}
		if (draft.metadata.quoteUri != null) {
			record.embed = {
				"$type": "app.bsky.embed.record",
				record: { uri: draft.metadata.quoteUri, cid: draft.metadata.quoteCid },
			};
		}
		const facets = await buildFacets(draft.body);
		if (facets.length > 0) { record.facets = facets; }
		const rkey = draft.metadata.rkey;
		const body = { collection: "app.bsky.feed.post", repo: did, rkey: rkey, record: record };
		const url = `${site}/xrpc/com.atproto.repo.createRecord`;
		await sendRequest(url, "POST", JSON.stringify(body), { "content-type": "application/json" });

		// Reply/quote controls are separate records sharing the post's rkey (Bluesky has no atomic multi-write).
		await writeGates(attributes, did, `at://${did}/app.bsky.feed.post/${rkey}`, rkey, createdAt, draft.metadata.parentUri != null);
	}
	else {
		throw new Error(`actionId "${actionId}" not implemented`);
	}
}
