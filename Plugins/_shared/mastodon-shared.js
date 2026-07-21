
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
				// "Replying to @X" annotations are intentionally omitted — they were inconsistent across timelines vs.
				// threads vs. mentions. Stashed below in case we revisit.
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

	// Carry visibility/language/content warning so a reply can default to the parent's — Mastodon doesn't inherit
	// any of them server-side. Only an author-written spoiler carries over (a bare `sensitive` flag has no text).
	post.metadata = { id: item.id, visibility: item["visibility"] ?? "public" };
	if (item["language"] != null) { post.metadata.language = item["language"]; }
	if (spoilerText != null && spoilerText.length > 0) { post.metadata.contentWarning = spoilerText; }

	post.actions.add("reply");

	post.actions.add(item?.favourited ? "unfavorite" : "favorite");
	post.actions.add(item?.reblogged ? "unboost" : "boost");
	// Quote only where the instance supports it (Mastodon 4.5+ / API v7). The quoted post's own approval policy may
	// still reject it at send — the server enforces that, surfaced as an error.
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
// Cached `/api/v2/instance` — the instance's capability sheet (status/media/poll limits, languages, …). Fetch the
// whole record once and read fields as needed. Public endpoint, so it works unauthenticated too. Weekly TTL; on
// failure falls back to the last good cache, else null.
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

// The instance's custom emoji, for `:`-autocomplete. Only picker-visible ones, keyed to their static image. Weekly
// TTL; a failed fetch degrades to stale cache, else an empty list.
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

// Whether this instance can author quote posts (Mastodon 4.5+ / API v7). Resolved once per load and cached so every
// postForItem offers the quote action consistently. Defaults false.
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

	// Character counting matched to the server: the instance's max, URLs weighed as the server does, a mention
	// counting only its "@user". Values from the cached instance record; defaults cover a failed fetch.
	const instance = await getInstance();
	const statuses = instance?.configuration?.statuses;
	const canQuote = supportsQuotePosts(instance);
	const shortcodes = await getCustomEmojis();   // the instance's custom emoji, for `:`-autocomplete
	// Video/gifv limits Mastodon REJECTS over (so decline at INTAKE, not mid-post): its frame-rate cap where the
	// instance reports one, plus MAX_VIDEO_FRAMES (a source constant, not in the config). Size + dimensions are the
	// per-upload concern of fitMedia. A gifv obeys the same video limits.
	const videoLimit = { fps: instance?.configuration?.media_attachments?.video_frame_rate_limit ?? 120, frames: 36000 };
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
		// `@` and `#` autocomplete via suggest() (account/hashtag search); `:` emoji is served by `shortcodes` above.
		suggestions: ["@", "#"],
		// Mastodon's real media rules: up to 4 images and animations MIXED (a shared budget of 4), OR one video alone,
		// OR one audio alone — three mutually exclusive options of the one media slot. A quote (when the instance
		// supports it) is its own combination, postable but never mixed with media.
		attachments: {
			slots: {
				media: [{ allow: ["image", "animation"], max: 4 }, { allow: ["video"] }, { allow: ["audio"] }],
				...(canQuote ? { quote: [{ allow: ["item"] }] } : {})
			},
			combinations: canQuote ? [["media"], ["quote"]] : [["media"]]
		},
		media: { upload: "eager", supportsAltText: ["image", "animation", "video", "audio"], supportsFocusPoint: ["image", "animation"], limits: { video: videoLimit, animation: videoLimit } }
	};

	if (actionId == "reply") {
		draft.header = "Reply to " + (target.author?.name ?? target.author?.username ?? "post");
		draft.body = await replyMentionPrefill(id);
		draft.context = [target];
		draft.metadata.replyTo = id;
		// Inherit the parent's visibility/language/content warning where present (best-effort); `send` re-applies the
		// CW as spoiler_text + sensitive.
		if (target?.metadata?.visibility != null) { draft.attributeValues.visibility = target.metadata.visibility; }
		if (target?.metadata?.language != null) { draft.attributeValues.language = target.metadata.language; }
		if (target?.metadata?.contentWarning != null) { draft.contentWarning = target.metadata.contentWarning; }
	} else if (actionId == "quote") {
		// A quote is a new post embedding another: the item shows as a preview attachment, its id rides metadata.
		draft.header = "Quote " + (target.author?.name ?? target.author?.username ?? "post");
		draft.attachments = [target];
		draft.metadata.quotedId = id;
	} else {
		draft.header = "New Post";
	}

	return draft;
}

// The setting controls Mastodon offers: visibility, post language, and — only on quote-capable instances (4.5+ /
// API v7) — who may quote. quotePolicy applies only to public/unlisted posts (the server forces private/direct to
// "nobody"), expressed via `availableWhen` and re-guarded in `send`.
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

// The @-mentions to prefill into a reply: the post's author plus everyone it mentions (Mastodon convention keeps the
// whole thread in the loop), minus yourself, deduped. Fetched fresh so the list is current — and if the fetch fails
// the error cancels the reply, which deliberately covers replying to a since-deleted post. Trailing-spaced, or "".
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

// Autocomplete for the `@`/`#` markers: branch on the marker. A bare marker (no query yet) returns nothing rather
// than dumping a huge list.
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

// A most-recent-first history of hashtags you've posted, preserving your casing — the same trick the Mastodon web
// composer uses (its search returns lowercased tags; the casing lives only in your own history). Deduped
// case-insensitively, capped, stored synced. Best-effort — a hiccup here must never fail a post that already succeeded.
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

// Fit + upload one attachment's bytes to /v2/media, returning its { id }. POST /v2/media returns 200 for images
// (synchronous) or 202 for video/gifv/audio still processing — then GET /v1/media/:id returns 206 while processing,
// 200 when ready, so poll() waits for the 200. Alt text / focus are NOT set here (they stay editable until posting);
// `send` applies them at submit.
async function uploadMedia(file, kind) {
	const fitted = await fitMedia(file, kind);
	const media = await fetch.post(`${site}/api/v2/media`, { multipart: [{ name: "file", file: fitted }] }).json();
	await poll(async () => (await fetch(`${site}/api/v1/media/${media.id}`).response()).status === 200);
	return { id: media.id, file: fitted };
}

// Fit picked bytes to what Mastodon accepts for their kind. Limits come from the instance's reported configuration
// where present, falling back to Mastodon's own source-code defaults (media_attachment.rb) as the floor when it
// didn't report them. Video and animation both go up as MP4 — an animation is a SILENT MP4, which Mastodon serves
// back as a looping gifv.
async function fitMedia(file, kind) {
	const m = (await getInstance())?.configuration?.media_attachments ?? {};
	if (kind == "image") { return imageTransform(file, ["jpeg", "png"], { maxBytes: m.image_size_limit ?? 16777216, maxPixels: 4096 }); }
	if (kind == "audio") { return audioTransform(file, ["m4a"], { maxBytes: m.video_size_limit ?? 103809024 }); }
	// Mastodon REJECTS a video that exceeds its pixel-matrix (DimensionsValidationError — it does NOT downscale), so we
	// must cap dimensions, not just size: hand the transform the byte budget (video_size_limit) and the longest-edge cap
	// for the matrix (video_matrix_limit is a width×height total, so √ it to stay under for any aspect ratio) and resize.
	const maxBytes = m.video_size_limit ?? 103809024;                           // 99 MiB (media_attachment.rb VIDEO_LIMIT)
	const maxPixels = Math.floor(Math.sqrt(m.video_matrix_limit ?? 8294400));   // matrix (w×h, 4K default) → longest edge
	if (kind == "video") { return videoTransform(file, ["mp4"], { maxBytes, maxPixels }); }
	// Animation accepts GIF too, listed after mp4: a fitting GIF passes through untouched (Mastodon makes the looping
	// gifv itself — no lossy H.264 transcode), while a silent-video-classified animation still goes to mp4.
	if (kind == "animation") { return animationTransform(file, ["mp4", "gif"], { maxBytes, maxPixels }); }
	throw new Error(`Can't upload media of kind "${kind}"`);
}

// Pre-upload one attachment during compose; return its server ref. `attachedAs` is the media kind — `fitMedia`
// dispatches on it.
async function uploadAttachment(file, attachedAs) {
	const uploaded = await uploadMedia(file, attachedAs);
	return UploadedAsset.create(uploaded.file, { id: uploaded.id });
}

// Apply alt text + focal point at submit, from the final edited values. Mastodon has no media_attributes on status
// CREATE (edit-only), so it's a PUT /v1/media/:id on the uploaded media.
async function updateMediaMetadata(id, description, focus) {
	await fetch(`${site}/api/v1/media/${id}`, { method: "PUT", json: { description: description, focus: focus } });
}

async function performAction(actionId, target, actionValue) {
	// Status id lives on item.metadata; older items stored it as the action value — fall back for those.
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
		// Here `target` is the draft. Create the status and return the new item.
		const draft = target;
		const attributes = draft.attributeValues ?? {};
		const contentWarning = draft.contentWarning;   // a first-class content field, not an attribute
		const hasContentWarning = contentWarning != null && contentWarning.length > 0;
		const visibility = attributes.visibility;

		// Resolve each attached media to a server id, then reference the ids on the status. A failed upload throws,
		// failing the whole post.
		const mediaAttachments = (draft.attachments ?? []).filter(a => a.kind == "media");
		const mediaIds = [];
		for (const attachment of mediaAttachments) {
			// Reference the ref if the media was pre-uploaded; otherwise upload its bytes now.
			const id = attachment.metadata?.id ?? (await uploadMedia(attachment.file, attachment.mediaType)).id;
			// Apply the FINAL alt text / focal point now, at submit (see updateMediaMetadata).
			const point = attachment.focalPoint;
			const focus = point ? `${point.x},${point.y}` : undefined;
			if (attachment.text || focus) { await updateMediaMetadata(id, attachment.text, focus); }
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

