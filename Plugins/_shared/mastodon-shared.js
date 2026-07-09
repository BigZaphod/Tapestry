
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
		attributes: composeAttributes(canQuote)
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
		const body = {
			status: draft.body,
			in_reply_to_id: draft.metadata?.replyTo,
			quoted_status_id: draft.metadata?.quotedId,
			visibility: visibility,
			language: attributes.language,
			spoiler_text: hasContentWarning ? contentWarning : undefined,
			sensitive: hasContentWarning ? true : undefined,
			// The server ignores the quote policy for followers-only/direct posts, so only send it when it applies.
			quote_approval_policy: (visibility == null || visibility == "public" || visibility == "unlisted") ? attributes.quotePolicy : undefined
		};
		const headers = {
			"Idempotency-Key": draft.metadata?.idempotencyKey ?? crypto.randomUUID(),
		};
		const status = await fetch.post(`${site}/api/v1/statuses`, { json: body, headers: headers }).json();
		return [postForItem(status)];
	}
	else {
		throw new Error(`actionId "${actionId}" not implemented`);
	}
}

