
// org.joinmastodon - shared

function normalizeAccount(account) {
	let result = account.trim();
	if (result.length > 1 && result.startsWith("@")) {
		result = result.slice(1);
	}
	return result;
}

function normalizeList(list) {
	return list.trim();
}

function normalizeTag(tag) {
	let result = tag.trim();
	if (result.length > 1 && result.startsWith("#")) {
		result = result.slice(1);
	}
	return result;
}

function postForItem(item) {
	const postDate = new Date(item["created_at"]);

	let shortcodes = {};
	let annotation = null;

	if (item["reblog"] != null) {
		const account = item["account"];
		const displayName = account["display_name"];
		const userName = account["username"];
		const accountName = (displayName ? displayName : userName);
		annotation = Annotation.createWithText(`${accountName} Boosted`);
		annotation.uri = account["url"];
		annotation.icon = account["avatar"];

		// We use the booster's display_name in the annotation and it may have custom emoji.
		const accountEmojis = account["emojis"];
		if (accountEmojis != null && accountEmojis.length > 0) {
			for (const emoji of accountEmojis) {
				shortcodes[emoji.shortcode] = emoji.static_url;
			}
		}

		// The rest of the info all comes from the boosted item itself.
		item = item["reblog"];
	}

	// Items boosted by the authenticated account override the annotation.
	if (item?.reblogged) {
		annotation = Annotation.createWithText("Boosted by you");
		annotation.uri = item.account["url"];
	}

	const uri = item["url"];
	const post = Item.createWithUriDate(uri, postDate);

	const account = item["account"];
	const displayName = account["display_name"];
	const userName = account["username"];
	const accountName = (displayName ? displayName : userName);
	const fullAccountName = account["acct"];
	const identity = Identity.createWithName(accountName);
	identity.username = "@" + fullAccountName;
	identity.uri = account["url"];
	identity.avatar = account["avatar"];
	post.author = identity;

	post.body = item["content"];

	const spoilerText = item["spoiler_text"];
	if (spoilerText != null && spoilerText.length > 0) {
		post.contentWarning = spoilerText;
	}
	else if (item["sensitive"] == true) {
		post.contentWarning = "Sensitive content";
	}
		
	if (annotation == null) {
		const visibility = item["visibility"] ?? "public";

		if (visibility == "private") {
			annotation = Annotation.createWithText(`FOLLOWERS ONLY`);
		}
		else if (visibility == "direct") {
			annotation = Annotation.createWithText(`PRIVATE MENTION`);
		}
		else if (visibility == "public" || visibility == "unlisted") {
			if (item.in_reply_to_account_id != null) {
				if (item.in_reply_to_account_id == account.id) {
					let text = "Replying to self";
					annotation = Annotation.createWithText(text);
					annotation.uri = account["url"];
				}
				// NOTE: At one point we added annotations for who a post is replying to, however it was originally
				// very inconsistent - specifically, it was added only on items from your own mentions timeline by the
				// main mastodon connector AND for every reply in the list connector regardless who posted it. But
				// not for the other connectors and not for other sources (like your main home timeline source) in
				// the regular connector!
				//
				// I have no idea how this situation came about, but it was very inconsistent and I'm trying to unify
				// these behaviors so that items loaded from a conversation thread, for example, end up being created
				// the same way as items from your main timeline or from a mention - otherwise there's some behaviors
				// in the UI where annotations can come and go depending on how an item was last downloaded which is
				// not great.
				/*
				else if (item.mentions != null && item.mentions.length > 0) {
					const mentions = item.mentions;
					const account = mentions[0];
					const userName = account["username"];
					let text = "Replying to @" + userName;
					if (mentions.length > 1) {
						text += " and others";
					}
					annotation = Annotation.createWithText(text);
					annotation.uri = account["url"];
				}
				*/
			}
		}
	}

	if (annotation != null) {
		post.annotations = [annotation];
	}

	const itemEmojis = item["emojis"];
	if (itemEmojis != null && itemEmojis.length > 0) {
		for (const emoji of itemEmojis) {
			shortcodes[emoji.shortcode] = emoji.static_url;
		}
	}

	const accountEmojis = account["emojis"];
	if (accountEmojis != null && accountEmojis.length > 0) {
		for (const emoji of accountEmojis) {
			shortcodes[emoji.shortcode] = emoji.static_url;
		}
	}

	post.shortcodes = shortcodes;

	// Carry the post's visibility, language, and content warning so a reply can default to them (Mastodon doesn't
	// inherit any of them server-side — the composer replicates the web client: default a reply to the parent's
	// visibility, never wider, prefill its language, and carry over its content warning). `item` here is the
	// displayed post (a boost was already unwrapped above). Only the author-written spoiler carries over — a bare
	// `sensitive` flag has no text to prefill and the web client doesn't propagate it to replies either.
	post.metadata = { id: item.id, visibility: item["visibility"] ?? "public" };
	if (item["language"] != null) { post.metadata.language = item["language"]; }
	if (spoilerText != null && spoilerText.length > 0) { post.metadata.contentWarning = spoilerText; }

	post.actions.add("reply");

	post.actions.add(item?.favourited ? "unfavorite" : "favorite");
	post.actions.add(item?.reblogged ? "unboost" : "boost");
	// Quote only where the instance supports it (Mastodon 4.5+ / API v7 — resolved once per load into `quoteCapable`).
	// The quoted post's own quote-approval policy may still reject the quote at send — the server enforces that,
	// surfaced as an error. Grouped with boost/unboost in actions.json so they share one cell button.
	if (quoteCapable) { post.actions.add("quote"); }
	post.actions.add(item?.bookmarked ? "unbookmark" : "bookmark");
	post.actions.add(item?.replies_count > 0 ? "replies" : "thread");

	// Only your own posts can be deleted. `account` is the post's author (a boost was already unwrapped to the
	// original post above), and "userId" is the authenticated account stored during verify/load.
	const myUserId = getItem("userId");
	if (myUserId != null && account?.id == myUserId) {
		post.actions.add("delete");
	}

	let attachments = [];

    const mediaAttachments = item["media_attachments"];
	if (mediaAttachments != null && mediaAttachments.length > 0) {
		for (const mediaAttachment of mediaAttachments) {
			const media = mediaAttachment["url"]
			const attachment = MediaAttachment.createWithUrl(media);
			if (mediaAttachment["preview_url"] != null) {
				attachment.thumbnail = mediaAttachment["preview_url"];
			}
			if (mediaAttachment["description"] != null) {
				attachment.text = mediaAttachment["description"];
			}
			if (mediaAttachment["blurhash"] != null) {
				attachment.blurhash = mediaAttachment["blurhash"];
			}
			if (mediaAttachment["meta"] != null) {
				const metadata = mediaAttachment["meta"];
				if (metadata["focus"] != null) {
					const focus = metadata["focus"];
					if (focus["x"] != null && focus["y"] != null) {
						attachment.focalPoint = {x : focus["x"], y: focus["y"]};
					}
				}
				if (metadata["original"] != null) {
					const original = metadata["original"];
					if (original["width"] != null && original["height"] != null) {
						attachment.aspectSize = {width : original["width"], height: original["height"]};
					}
				}
			}
			let mimeType = "application/octet-stream";
			const mediaType = mediaAttachment["type"];
			if (mediaType == "video" || mediaType == "gifv") {
				mimeType = "video/mp4";
			}
			else if (mediaType == "audio") {
				if (media.endsWith(".aac")) {
					mimeType = "audio/aac";
				}
				else if (media.endsWith(".mp3")) {
					mimeType = "audio/mpeg";
				}
				else {
					mimeType = "audio/*";
				}
			}
			else if (mediaType == "image") {
				if (media.endsWith(".png")) {
					mimeType = "image/png";
				}
				else if (media.endsWith(".jpg") || media.endsWith(".jpeg")) {
					mimeType = "image/jpeg";
				}
				else {
					mimeType = "image/*";
				}
			}
			attachment.mimeType = mimeType;
			attachments.push(attachment);
		}
	}

    const quote = item["quote"];
    if (quote != null && quote.quoted_status != null) {
        let attachment = postForItem(quote.quoted_status)
        attachments.push(attachment);
    }

    const card = item["card"];
    if (card != null && card.url != null) {
        let attachment = LinkAttachment.createWithUrl(card.url);
        if (card.type != null && card.type.length > 0) {
            attachment.type = card.type;
        }
        if (card.title != null && card.title.length > 0) {
            attachment.title = card.title;
        }
        if (card.description != null && card.description.length > 0) {
            attachment.subtitle = card.description;
        }
        if (card.author_name != null && card.author_name.length > 0) {
            attachment.authorName = card.author_name;
        }
        if (card.author_url != null && card.author_url.length > 0) {
            attachment.authorProfile = card.author_url;
        }
        if (card.image != null && card.image.length > 0) {
            attachment.image = card.image;
        }
        if (card.blurhash != null && card.blurhash.length > 0) {
            attachment.blurhash = card.blurhash;
        }
        if (card.width != null && card.height != null) {
            attachment.aspectSize = {width : card.width, height: card.height};
        }
        attachments.push(attachment);
    }

    const poll = item["poll"];
    if (poll != null && poll.options != null && poll.expires_at != null) {
        let attachment = PollAttachment.create();
        attachment.options = poll.options.map((option) => PollOption.create(option.title, option.votes_count));
        attachment.endDate = new Date(poll.expires_at);
        attachment.multipleChoice = poll?.multiple ?? false;
        attachments.push(attachment);
    }

	post.attachments = attachments;
	
	return post;
}

// By being in mastodon-shared.js, all of the mastodon connectors get this.
// However, most actions will not work unless authenticated! So be sure to
// edit the actions.json file for each connector and only include the ones
// that can actually work for the non-authorized connector variants!
// The cached `/api/v2/instance` record. This endpoint is the instance's capability sheet — status limits (the
// character counter), media limits + supported types + alt-text length (attachments), poll limits, available
// languages, and more — so we cache the WHOLE record once and read fields from it as each feature needs them,
// rather than re-fetching per field. It's a PUBLIC endpoint, so this works for the unauthenticated variants too.
// Soft 1-week TTL (it changes rarely); on failure returns the last good cache, else null so callers can default.
// A stale or missing record must never block composing.
async function getInstance() {
	const TTL = 7 * 24 * 60 * 60 * 1000;   // one week
	const cached = getItem("instance");
	const stored = cached != null ? JSON.parse(cached) : null;
	if (stored != null && Date.now() - stored.fetchedAt < TTL) {
		return stored.record;   // still fresh — no fetch
	}

	try {
		const record = await fetch(`${site}/api/v2/instance`).json();
		setItem("instance", JSON.stringify({ fetchedAt: Date.now(), record }));
		return record;
	} catch (error) {
		console.log(`getInstance fetch failed, using ${stored != null ? "stale cache" : "defaults"}: ${error}`);
		return stored?.record ?? null;
	}
}

// The instance's custom emoji, mapped to the composer's `rules.shortcodes` shape for `:`-autocomplete — a bounded
// local set, so no suggest() verb is involved. Only picker-visible emoji are offered, keyed to their static image.
// Soft 1-week TTL like the instance record (custom emoji change rarely); a failed fetch degrades to stale cache, else
// an empty list, so composing never blocks on it (and an empty list just means the `:` trigger stays inactive).
async function getCustomEmojis() {
	const TTL = 7 * 24 * 60 * 60 * 1000;   // one week
	const cached = getItem("customEmojis");
	const stored = cached != null ? JSON.parse(cached) : null;
	if (stored != null && Date.now() - stored.fetchedAt < TTL) {
		return stored.shortcodes;   // still fresh — no fetch
	}

	try {
		const emojis = await fetch(`${site}/api/v1/custom_emojis`).json();
		const shortcodes = emojis
			.filter(emoji => emoji.visible_in_picker !== false)
			.map(emoji => ({ shortcode: emoji.shortcode, url: emoji.static_url ?? emoji.url, category: emoji.category }));
		setItem("customEmojis", JSON.stringify({ fetchedAt: Date.now(), shortcodes }));
		return shortcodes;
	} catch (error) {
		console.log(`getCustomEmojis fetch failed, using ${stored != null ? "stale cache" : "none"}: ${error}`);
		return stored?.shortcodes ?? [];
	}
}

// Whether the current (authenticated) instance can author quote posts (Mastodon 4.5+ / API v7). Resolved ONCE per
// load (see load) and cached module-side so every postForItem path — home/mentions/statuses, the thread action, and
// the just-posted item — offers the quote action consistently, without threading a flag through each call site. A
// plain module global earns its keep here: it defaults false (no quote), and load always runs before any item can be
// acted on, so the natural flow keeps it correct. `supportsQuotePosts` stays a pure check on the instance record.
let quoteCapable = false;

function supportsQuotePosts(instance) {
	return (instance?.api_versions?.mastodon ?? 0) >= 7;
}

// Build a fresh compose draft. `reply` seeds the parent (mentions prefilled, `in_reply_to_id` in metadata);
// `newPost` starts blank. Both mint an idempotency key up front and submit through the same `send` verb.
async function composeDraft(actionId, target, id) {
	const draft = Draft.create();
	draft.metadata = { idempotencyKey: crypto.randomUUID() };
	draft.actions.add("send");

	// How the app counts characters, matching the server: the instance's own max, every URL weighed the way the
	// server does, and a mention counting only its "@user" (the @domain is free). Per-instance values come from the
	// cached instance record; the defaults cover a failed fetch or a server predating /api/v2.
	const instance = await getInstance();
	const statuses = instance?.configuration?.statuses;
	const canQuote = supportsQuotePosts(instance);
	const shortcodes = await getCustomEmojis();   // the instance's custom emoji, for `:`-autocomplete
	draft.rules = {
		characterUnit: "graphemes",
		// The main counter's limit (default 500) spans the body AND the content warning — both count against it.
		characterCounter: { fields: ["body", "contentWarning"], characterLimit: { maxLength: statuses?.max_characters ?? 500 } },
		fields: {
			// The body is weighted; the content warning is a plain optional field (its URLs/mentions are NOT weighted).
			body: {
				placeholder: actionId == "reply" ? "Post your reply" : "What's on your mind?",
				weights: {
					// URL → the reserved weight (23). The trailing class stops the match before sentence punctuation so
					// it counts naturally, matching the server (twitter-text's URL regex) and erring toward NOT
					// swallowing real text (an over-long match would undercount).
					"https?://[^\\s]*[^\\s.,;:!?)\\]}]": statuses?.characters_reserved_per_url ?? 23,
					// Mention → "@user", the @domain free ($1 is the "@user" part). The lookbehind mirrors the server's
					// MENTION_RE: an @ glued to a preceding word char (or = or /) is NOT a mention.
					"(?<![=/\\w])(@\\w+(?:[.-]+\\w+)*)(?:@[\\w.-]+)?": "$1"
				}
			},
			contentWarning: { availability: "optional" }   // opt-in; the user reveals it to add a warning
		},
		attributes: composeAttributes(canQuote),
		shortcodes: shortcodes,
		// `@` mentions and `#` hashtags autocomplete through the suggest() verb (account/hashtag search). `:` emoji is
		// served by the shortcodes above, not here.
		suggestions: ["@", "#"],
		// Up to 4 images. usesUploadAttachment:false — the send verb does the /v2/media upload itself rather than the
		// app pre-uploading each one. A quote (when the instance supports it) is its own combination, so it stays
		// postable but isn't mixed with media (matches quote-alone behavior).
		attachments: {
			slots: canQuote
				? { media: [{ allow: ["image"], max: 4 }], quote: [{ allow: ["item"] }] }
				: { media: [{ allow: ["image"], max: 4 }] },
			combinations: canQuote ? [["media"], ["quote"]] : [["media"]]
		},
		media: { usesUploadAttachment: true, supportsAltText: ["image"], supportsFocusPoint: ["image"] }
	};

	if (actionId == "reply") {
		draft.header = "Reply to " + (target.author?.name ?? target.author?.username ?? "post");
		draft.body = await replyMentionPrefill(id);
		draft.context = [target];
		draft.metadata.replyTo = id;
		// Inherit the parent's visibility/language/content warning where the item carried them (best-effort). Setting
		// draft.contentWarning is enough to surface the field — the composer auto-reveals a hidden content field whose
		// value is non-empty — and `send` re-applies it as spoiler_text + sensitive.
		if (target?.metadata?.visibility != null) { draft.attributeValues.visibility = target.metadata.visibility; }
		if (target?.metadata?.language != null) { draft.attributeValues.language = target.metadata.language; }
		if (target?.metadata?.contentWarning != null) { draft.contentWarning = target.metadata.contentWarning; }
	} else if (actionId == "quote") {
		// A quote is a new top-level post embedding another. The full item rides `attachments` for the composer
		// preview; the status id used to build the quote at send rides `metadata`, like the reply ref.
		draft.header = "Quote " + (target.author?.name ?? target.author?.username ?? "post");
		draft.attachments = [target];
		draft.metadata.quotedId = id;
	} else {
		draft.header = "New Post";
	}

	return draft;
}

// The composer controls Mastodon offers: visibility, an optional content warning (which also marks the post
// sensitive), post language, and — only on quote-capable instances (4.5+ / API v7) — who may quote the post. The app
// renders these and writes the chosen values onto draft.attributeValues; `send` reads them back. quotePolicy is only
// meaningful for public/unlisted posts — the server forces private/direct posts to "nobody" — which the
// `availableWhen` expresses (and `send` re-guards).
function composeAttributes(canQuote) {
	const attributes = [
		{
			name: "visibility", prompt: "Visibility", defaultValue: "public",
			choices: [
				{ value: "public", prompt: "Public", description: "Anyone on and off Mastodon", icon: "globe" },
				{ value: "unlisted", prompt: "Quiet public", description: "Hidden from Mastodon search results, trending, and public timelines", icon: "moon" },
				{ value: "private", prompt: "Followers", description: "Only your followers", icon: "lock" },
				{ value: "direct", prompt: "Private mention", description: "Everyone mentioned in the post", icon: "at" }
			]
		}
	];
	// "Who can quote" is meaningful only where the server understands quotes (Mastodon 4.5+ / API v7); omit it elsewhere.
	if (canQuote) {
		attributes.push({
			name: "quotePolicy", prompt: "Who can quote", defaultValue: "public",
			availableWhen: { attribute: "visibility", oneOf: ["public", "unlisted"] },
			choices: [
				{ value: "public", prompt: "Anyone", icon: "quote.bubble" },
				{ value: "followers", prompt: "Followers", icon: "person.2" },
				{ value: "nobody", prompt: "Just me", icon: "nosign" }
			]
		});
	}
	attributes.push({ name: "language", type: "language" });
	return attributes;
}

// The @-mentions to prefill into a reply: the post's author plus everyone it mentions (the Mastodon convention is
// to keep the whole thread in the loop), minus yourself, deduped. Fetched fresh from the status so an edited
// mention list is current — the composer already shows a loading state while this runs, and a future context view
// can extend this same lookup. The fetch is load-bearing: if it fails, the error propagates and cancels the reply.
// That deliberately covers the deleted-post case — better to fail than open a composer to reply to a post that's
// gone (a cached-author fallback would silently mask it). Returns a trailing-spaced string, or "".
async function replyMentionPrefill(id) {
	const myUserId = getItem("userId");
	const status = await fetch(`${site}/api/v1/statuses/${id}`).json();
	const participants = [status.account, ...(status.mentions ?? [])];
	const seen = new Set();
	const tokens = [];
	for (const person of participants) {
		if (person?.acct == null || seen.has(person.acct)) { continue; }
		if (myUserId != null && person.id == myUserId) { continue; }
		seen.add(person.acct);
		tokens.push("@" + person.acct);
	}
	return tokens.length > 0 ? tokens.join(" ") + " " : "";
}

// The suggest() verb: autocomplete for the markers the composer declares (rules.suggestions, set in composeDraft).
// `match` is the whole token as typed, marker included ("@ali", "#swi"); we branch on the marker and return rows the
// composer shows verbatim. Each row's insertText is the bare mention/hashtag — the composer appends the trailing space
// itself. A bare "@"/"#" (no query yet) returns nothing rather than dumping a huge list. Failures just propagate: the
// host logs a failed lookup and shows no rows, so there's nothing to catch here.
async function suggest(match) {
	const marker = match[0];
	const query = match.slice(1);   // drop the marker; "" for a bare "@" / "#"
	if (marker === "@") { return await suggestAccounts(query); }
	if (marker === "#") { return await suggestHashtags(query); }
	return [];
}

// Account autocomplete via /api/v1/accounts/search (authenticated). We rely on the endpoint's default of NOT resolving
// unknown handles: leaving `resolve` off means no per-keystroke WebFinger fetch — only locally known accounts are
// searched. `acct` is "user" locally or "user@domain" for a remote account — exactly the mention text to insert.
async function suggestAccounts(query) {
	if (query.length === 0) { return []; }
	const accounts = await fetch(`${site}/api/v1/accounts/search?q=${encodeURIComponent(query)}`).json();
	return accounts.map(account => ({
		id: account.id,
		display: "@" + account.acct,
		detail: account.display_name || account.username,
		avatar: account.avatar,
		insertText: "@" + account.acct
	}));
}

// Hashtag autocomplete via /api/v2/search?type=hashtags (authenticated). Hashtags carry no avatar (the composer falls
// back to a symbol). The server's `tag.name` is often LOWERCASED (mastodon.social returns "tapestryapp" for what its
// own web UI shows as "TapestryApp") — because that mixed casing comes from each user's LOCAL tag history, not the
// API. So we do the same: a most-recent-first history of tags YOU'VE posted (with your casing) is merged ahead of the
// server results and deduped case-insensitively, so a tag you use shows with your casing. See rememberHashtags.
// The API's tag.history gives recent-usage counts, surfaced as each row's detail line (keyed by lowercased name, so a
// history-cased tag still picks up the server's count); history-only tags with no API match show no count.
async function suggestHashtags(query) {
	if (query.length === 0) { return []; }
	const results = await fetch(`${site}/api/v2/search?q=${encodeURIComponent(query)}&type=hashtags`).json();
	const history = historyHashtags(query);
	const seen = new Set(history.map(tag => tag.toLowerCase()));
	const names = [...history];
	const details = new Map();
	for (const tag of (results.hashtags ?? [])) {
		details.set(tag.name.toLowerCase(), usageDetail(tag));
		if (!seen.has(tag.name.toLowerCase())) { seen.add(tag.name.toLowerCase()); names.push(tag.name); }
	}
	return names.map(name => {
		const detail = details.get(name.toLowerCase());
		return detail ? { display: "#" + name, insertText: "#" + name, detail } : { display: "#" + name, insertText: "#" + name };
	});
}

// A hashtag's recent activity as a short row detail — the exact total posts across the ~7 daily buckets in tag.history
// (uses arrives as a string), digit-grouped for the user's locale via toLocaleString (JSC's Intl gives 1,234,567 /
// 1.234.567 / 12,34,567 as appropriate). Undefined when the API reports no activity, so the row omits the line.
function usageDetail(tag) {
	const total = (tag.history ?? []).reduce((sum, day) => sum + (Number(day.uses) || 0), 0);
	if (total === 0) { return undefined; }
	return `${total.toLocaleString()} recent ${total === 1 ? "post" : "posts"}`;
}

// A most-recent-first history of hashtags posted FROM Tapestry, preserving the casing the user typed — the same trick
// the Mastodon web composer uses (the server's search can't provide it; the casing lives in each user's own history).
// Deduped case-insensitively and capped. Stored SYNCED (setItem/getItem `synced: true`) so it follows the account
// across the user's devices via iCloud. Best-effort: on an app without synced storage it just falls back to local, and
// a hiccup here must NEVER fail a post that already succeeded, hence the catch (unlike suggest, which lets errors
// propagate to the host).
const TAG_HISTORY_MAX = 100;

function rememberHashtags(text) {
	try {
		const used = [...(text ?? "").matchAll(/(?<![^\s])[#＃]([\p{L}\p{N}_]+)/gu)].map(match => match[1]);
		if (used.length === 0) { return; }
		let history = JSON.parse(getItem("tagHistory", true) ?? "[]");
		for (const tag of used.reverse()) {   // reverse so the first tag typed ends up nearest the front
			history = history.filter(existing => existing.toLowerCase() !== tag.toLowerCase());
			history.unshift(tag);
		}
		setItem("tagHistory", JSON.stringify(history.slice(0, TAG_HISTORY_MAX)), true);
	} catch (error) {
		console.log(`rememberHashtags failed (non-fatal): ${error}`);
	}
}

// The remembered tags whose casing-insensitive prefix matches what the user is typing — merged ahead of the API
// results by suggestHashtags. Degrades to none on any storage/parse hiccup (a real fallback: the API still answers).
function historyHashtags(query) {
	try {
		const lowerQuery = query.toLowerCase();
		return JSON.parse(getItem("tagHistory", true) ?? "[]").filter(tag => tag.toLowerCase().startsWith(lowerQuery));
	} catch (error) {
		return [];
	}
}

// Upload one image's BYTES to /v2/media and return its attachment { id }. Bytes-only on purpose — NOT alt text or
// focus: those are user-editable up until the moment of posting, so applying them here would capture stale values
// once the app pre-uploads early (the uploadAttachment path). They're set at SUBMIT instead, from the final draft
// values, via `updateMediaMetadata` (PUT /v1/media/:id) — see `send`. Fits the picked bytes to the instance's
// limits first (imageTransform is a pass-through when they already fit). A 202 means the server is still processing
// (the media has no `url` yet) — poll until it's ready; images usually return 200 immediately, so this rarely runs
// (there's no timer to space polls, so they're network-paced and capped).
//
// A STANDALONE, bytes-only helper on purpose: `send` calls it now (the app hands us the bytes at submit —
// usesUploadAttachment is false), and a future `uploadAttachment` verb calls the exact same helper to pre-upload.
async function uploadMedia(file) {
	const limits = (await getInstance())?.configuration?.media_attachments;
	const fitted = await imageTransform(file, ["jpeg", "png"], {
		maxBytes: limits?.image_size_limit ?? 16777216,   // 16 MiB — the modern Mastodon default
		maxPixels: 4096
	});
	let media = await fetch.post(`${site}/api/v2/media`, { multipart: [{ name: "file", file: fitted }] }).json();
	for (let i = 0; media.url == null && i < 30; i++) {
		media = await fetch(`${site}/api/v1/media/${media.id}`).json();
	}
	return { id: media.id, file: fitted };
}

// The uploadAttachment verb: pre-upload one attachment's bytes during compose (the app pre-uploads when
// usesUploadAttachment is true, for progress + a fast submit) and hand back a DraftAsset carrying the server ref.
// Same helper `send` uses in the carried-at-submit mode — the only difference is WHEN the app calls it.
async function uploadAttachment(file) {
	const uploaded = await uploadMedia(file);
	return DraftAsset.create(uploaded.file, { id: uploaded.id });
}

// Apply an attachment's alt text + focal point to an already-uploaded (but not-yet-attached) media, at SUBMIT.
// Separate from the upload so it always reads the FINAL edited values — race-free whether the bytes were uploaded
// just now (usesUploadAttachment false) or pre-uploaded while the user kept editing (the uploadAttachment path).
// Mastodon has no media_attributes on status CREATE (that's edit-only), so this is PUT /v1/media/:id.
async function updateMediaMetadata(id, description, focus) {
	await fetch(`${site}/api/v1/media/${id}`, { method: "PUT", json: { description: description, focus: focus } });
}

async function performAction(actionId, target, actionValue) {
	// 2.0 stores the status id on the item's metadata; older items stored it as the
	// action's value. Fall back for those. Removable a few months after 2.0
	// ships publicly, once pre-2.0 items have expired out of catalogs.
	// `target` is null for a feed-targeted action (newPost) — the `?.` keeps that from throwing here.
	const id = target?.metadata?.id ?? actionValue;

	// A fast unboost -> boost can 422 with "Reblog of post already exists": the unreblog's removal is processed
	// asynchronously server-side, and the re-reblog trips the uniqueness check against the not-yet-deleted row.
	// Deliberately NOT handled: treating it as success would disagree with the server's final (unboosted) state,
	// and there's no timer surface to retry with. Surfacing the error is honest; a human retry succeeds.
	if (actionId == "favorite") {
		await fetch.post(`${site}/api/v1/statuses/${id}/favourite`);
		target.actions.delete("favorite");
		target.actions.add("unfavorite");
		return target;
	}
	else if (actionId == "unfavorite") {
		await fetch.post(`${site}/api/v1/statuses/${id}/unfavourite`);
		target.actions.delete("unfavorite");
		target.actions.add("favorite");
		return target;
	}
	else if (actionId == "boost") {
		await fetch.post(`${site}/api/v1/statuses/${id}/reblog`);
		target.actions.delete("boost");
		target.actions.add("unboost");
		target.annotations = [Annotation.createWithText("Boosted by you")];
		return target;
	}
	else if (actionId == "unboost") {
		await fetch.post(`${site}/api/v1/statuses/${id}/unreblog`);
		target.actions.delete("unboost");
		target.actions.add("boost");
		target.annotations = [];
		return target;
	}
	else if (actionId == "bookmark") {
		await fetch.post(`${site}/api/v1/statuses/${id}/bookmark`);
		target.actions.delete("bookmark");
		target.actions.add("unbookmark");
		return target;
	}
	else if (actionId == "unbookmark") {
		await fetch.post(`${site}/api/v1/statuses/${id}/unbookmark`);
		target.actions.delete("unbookmark");
		target.actions.add("bookmark");
		return target;
	}
	else if (actionId == "thread" || actionId == "replies") {
		// Thread posts are quotable too — resolve the capability here so quote appears in a thread view even if this
		// context hasn't run load() (postForItem reads `quoteCapable`). getInstance() is cached, so this is cheap.
		quoteCapable = supportsQuotePosts(await getInstance());
		const context = await fetch(`${site}/api/v1/statuses/${id}/context`).json();
		let results = [];
		// `item` here is a raw Mastodon status from the API (as postForItem expects); `target` is our Item.
		for (const item of context["ancestors"]) {
			results.push(postForItem(item));
		}
		results.push(target);
		for (const item of context["descendants"]) {
			results.push(postForItem(item));
		}
		return results;
	}
	else if (actionId == "delete") {
		await fetch.delete(`${site}/api/v1/statuses/${id}`);
		return [Item.delete(target.uri)];
	}
	else if (actionId == "reply" || actionId == "newPost" || actionId == "quote") {
		return composeDraft(actionId, target, id);
	}
	else if (actionId == "send") {
		// Here `target` is the DRAFT (a target:"draft" action). Create the status and return the new item; it
		// lands in the timeline on the next refresh.
		const draft = target;
		const attributes = draft.attributeValues ?? {};
		const contentWarning = draft.contentWarning;   // a first-class content field, not an attribute
		const hasContentWarning = contentWarning != null && contentWarning.length > 0;
		const visibility = attributes.visibility;

		// Upload each attached image first (the app carried the bytes to submit — usesUploadAttachment is false),
		// then reference the resulting ids on the status. A failed upload throws, failing the whole post.
		const mediaAttachments = (draft.attachments ?? []).filter(a => a.kind == "media");
		const mediaIds = [];
		for (const attachment of mediaAttachments) {
			// Mode-agnostic: a pre-uploaded attachment already carries its ref (`metadata.id`); one carried to
			// submit still has its bytes (`file`) and is uploaded here. So `send` works whether the app pre-uploads
			// (usesUploadAttachment true) or not — the same media flows through either way.
			const id = attachment.metadata?.id ?? (await uploadMedia(attachment.file)).id;
			// Apply the FINAL alt text / focal point now, at submit (see updateMediaMetadata).
			const point = attachment.focalPoint;
			const focus = point ? `${point.x},${point.y}` : undefined;
			if (attachment.altText || focus) { await updateMediaMetadata(id, attachment.altText, focus); }
			mediaIds.push(id);
		}

		const body = {
			status: draft.body,
			in_reply_to_id: draft.metadata?.replyTo,
			quoted_status_id: draft.metadata?.quotedId,
			visibility: visibility,
			language: attributes.language,
			media_ids: mediaIds.length > 0 ? mediaIds : undefined,
			spoiler_text: hasContentWarning ? contentWarning : undefined,
			sensitive: hasContentWarning ? true : undefined,
			// The server ignores the quote policy for followers-only/direct posts, so only send it when it applies.
			quote_approval_policy: (visibility == null || visibility == "public" || visibility == "unlisted") ? attributes.quotePolicy : undefined
		};
		const headers = {
			"Idempotency-Key": draft.metadata?.idempotencyKey ?? crypto.randomUUID(),
		};
		const status = await fetch.post(`${site}/api/v1/statuses`, { json: body, headers: headers }).json();
		rememberHashtags(draft.body);   // remember the tags you just used (with your casing) for future autocomplete
		return [postForItem(status)];
	}
	else {
		throw new Error(`actionId "${actionId}" not implemented`);
	}
}

