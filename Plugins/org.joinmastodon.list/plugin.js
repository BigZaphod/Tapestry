
// org.joinmastodon.list

if (require('mastodon-shared.js') === false) {
	throw new Error("Failed to load mastodon-shared.js");
}

async function verify() {
	const credentialsText = await sendRequest(site + "/api/v1/accounts/verify_credentials");
	const credentials = JSON.parse(credentialsText);

	const userName = "@" + credentials["username"];
	const icon = credentials["avatar"];

	const userId = credentials["id"];
	setItem("userId", userId);

	const listsText = await sendRequest(site + "/api/v1/lists");
	const lists = JSON.parse(listsText);

	const verifyList = normalizeList(list);
	let found = false;
	let displayName = userName;
	for (const listItem of lists) {
		if (listItem.id == verifyList || listItem.title == verifyList) {
			setItem("listId", listItem.id);
			displayName = `${listItem.title} - ${userName}`;
			found = true;
		}
	}

	if (!found) {
		throw new Error("Invalid List Identifier");
	}

	return {
		displayName: displayName,
		icon: icon
	};
}

async function load() {
	var listId = getItem("listId");

	if (listId == null) {
		const text = await sendRequest(site + "/api/v1/lists");
		const jsonObject = JSON.parse(text);

		const loadList = normalizeList(list);
		for (const listItem of jsonObject) {
			if (listItem.id == loadList || listItem.title == loadList) {
				setItem("listId", listItem.id);
				listId = listItem.id;
			}
		}

		if (listId == null) {
			throw new Error("Invalid List Identifier");
		}
	}

	return await queryStatusesForList(listId);
}

function queryStatusesForList(listId) {

	return new Promise((resolve, reject) => {
		sendRequest(site + "/api/v1/timelines/list/" + listId + "?limit=40")
		.then((text) => {
			const jsonObject = JSON.parse(text);
			let results = [];
			
			let annotation = Annotation.createWithText(`Posted in ${list}`);

			for (const item of jsonObject) {
				if (item.reblog != null && includeBoosts != "on") {
					continue;
				}
				if (item.quote != null && includeQuotes != "on") {
					continue;
				}
				let post = postForItem(item);
				if (post != null) {
					post.annotations = [annotation].concat(post.annotations ?? []);
					results.push(post);
				}
			}
			resolve(results);
		})
		.catch((error) => {
			reject(error);
		});
	});
	
}
