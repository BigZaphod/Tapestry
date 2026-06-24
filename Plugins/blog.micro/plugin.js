
// blog.micro

async function verify() {
	const text = await sendRequest(`${site}/account/verify`, "POST", "token=__ACCESS_TOKEN__")
	const jsonObject = JSON.parse(text);

	if (jsonObject["username"] != null) {
		displayName = "@" + jsonObject["username"];

		var icon = null;
		if (jsonObject["avatar"] != null) {
			icon = jsonObject["avatar"];
		}
		else {
			icon = "https://cdn.micro.blog/images/icons/favicon_192.png";
		}

		const verification = {
			displayName: displayName,
			icon: icon
		};
		return verification;
	}
	else {
		const message = jsonObject["error"] ?? "Invalid response";
		throw new Error(message);
	}
}

async function load() {
	const filterMentions = includeMentions != "on";
	
	const text = await sendRequest(`${site}/posts/timeline?count=200`);
	const jsonObject = JSON.parse(text);
	const items = jsonObject["items"];
	var results = [];
	for (const item of items) {
		const post = postForItem(item, filterMentions);
		if (post != null) {
			results.push(post);
		}
	}
	return results;
}

async function performAction(actionId, item) {
	const id = item.metadata.id;

	if (actionId == "bookmark") {
		const text = await sendRequest(`${site}/posts/favorites`, "POST", `id=${id}`)

		item.removeAction("bookmark");
		item.addAction("unbookmark");
		return item;
	}
	else if (actionId == "unbookmark") {
		const text = await sendRequest(`${site}/posts/favorites/${id}`, "DELETE")

		item.removeAction("unbookmark");
		item.addAction("bookmark");
		return item;
	}
	else if (actionId == "replies" || actionId == "thread") {
		const response = await sendRequest(`${site}/posts/conversation?id=${id}`)
		const json = JSON.parse(response);

		let results = [];
		let replies = json.items;
		replies.reverse(); // the Micro.blog API returns most recent reply first, Tapestry needs opposite order
		for (const reply of replies) {
			results.push(postForItem(reply, false));
		}
		return results;
	}
	else {
		throw new Error(`actionId "${actionId}" not implemented`);
	}
}

function postForItem(item, filterMentions) {
	if (filterMentions) {
		if (item["_microblog"].is_mention) {
			return null;
		}
	}
	
	const author = item.author;
	const identity = Identity.createWithName(author.name);
	identity.uri = author.url;
	identity.avatar = author.avatar;
	identity.username = "@" + author._microblog.username
	
	const url = item.url;
	const date = new Date(item.date_published);
	const content = item.content_html;
	const post = Item.createWithUriDate(url, date);
	post.body = content;
	post.author = identity;
	post.metadata = { id: item.id };
	post.addAction(item["_microblog"].is_bookmark ? "unbookmark" : "bookmark");
	post.addAction(item["_microblog"].is_conversation ? "replies" : "thread");
	
	return post;
}
