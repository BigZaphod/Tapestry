
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

	post.metadata = { id: item.id };

	//post.addAction("reply");

	post.addAction(item?.favourited ? "unfavorite" : "favorite");
	post.addAction(item?.reblogged ? "unboost" : "boost");
	post.addAction(item?.bookmarked ? "unbookmark" : "bookmark");
	post.addAction(item?.replies_count > 0 ? "replies" : "thread");

	// Only your own posts can be deleted. `account` is the post's author (a boost was already unwrapped to the
	// original post above), and "userId" is the authenticated account stored during verify/load.
	const myUserId = getItem("userId");
	if (myUserId != null && account?.id == myUserId) {
		post.addAction("delete");
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
async function performAction(actionId, item) {
	// 2.0 stores the status id in item.metadata; older items stored it as the
	// action's value. Fall back for those. Removable a few months after 2.0
	// ships publicly, once pre-2.0 items have expired out of catalogs.
	const id = item.metadata?.id ?? item.actions?.[actionId];

	if (actionId == "favorite") {
		await sendRequest(`${site}/api/v1/statuses/${id}/favourite`, "POST");
		item.removeAction("favorite");
		item.addAction("unfavorite");
		return item;
	}
	else if (actionId == "unfavorite") {
		await sendRequest(`${site}/api/v1/statuses/${id}/unfavourite`, "POST");
		item.removeAction("unfavorite");
		item.addAction("favorite");
		return item;
	}
	else if (actionId == "boost") {
		await sendRequest(`${site}/api/v1/statuses/${id}/reblog`, "POST");
		item.removeAction("boost");
		item.addAction("unboost");
		item.annotations = [Annotation.createWithText("Boosted by you")];
		return item;
	}
	else if (actionId == "unboost") {
		await sendRequest(`${site}/api/v1/statuses/${id}/unreblog`, "POST");
		item.removeAction("unboost");
		item.addAction("boost");
		item.annotations = [];
		return item;
	}
	else if (actionId == "bookmark") {
		await sendRequest(`${site}/api/v1/statuses/${id}/bookmark`, "POST");
		item.removeAction("bookmark");
		item.addAction("unbookmark");
		return item;
	}
	else if (actionId == "unbookmark") {
		await sendRequest(`${site}/api/v1/statuses/${id}/unbookmark`, "POST");
		item.removeAction("unbookmark");
		item.addAction("bookmark");
		return item;
	}
	else if (actionId == "thread" || actionId == "replies") {
		const context = JSON.parse(await sendRequest(`${site}/api/v1/statuses/${id}/context`));
		let results = [];
		for (const item of context["ancestors"]) {
			results.push(postForItem(item));
		}
		results.push(item);
		for (const item of context["descendants"]) {
			results.push(postForItem(item));
		}
		return results;
	}
	else if (actionId == "delete") {
		await sendRequest(`${site}/api/v1/statuses/${id}`, "DELETE");
		return [Item.delete(item.uri)];
	}
	else {
		throw new Error(`actionId "${actionId}" not implemented`);
	}
}

