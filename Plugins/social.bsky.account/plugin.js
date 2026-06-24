
// social.bsky.account

if (require('bluesky-shared.js') === false) {
    throw new Error("Failed to load bluesky-shared.js");
}

async function verify() {
	let verifyAccount = normalizeAccount(account);
	const text = await sendRequest(site + `/xrpc/app.bsky.actor.getProfile?actor=${verifyAccount}`);
	const jsonObject = JSON.parse(text);

	let displayName = "";
	if (jsonObject.displayName != null && jsonObject.displayName.length > 0) {
		displayName = jsonObject.displayName;
	}
	else {
		displayName = "@" + jsonObject.handle;
	}

	const did = jsonObject.did;
	setItem("did", did);

	if (jsonObject.avatar != null) {
		return {
			displayName: displayName,
			icon: jsonObject.avatar
		};
	}
	else {
		return displayName;
	}
}

async function load() {
	var did = getItem("did");
	if (did == null) {
		const loadAccount = normalizeAccount(account);
		did = await getAccountDid(loadAccount);
		setItem("did", did);
	}

	return await queryFeedForUser(did);
}

function queryFeedForUser(did) {

	return new Promise((resolve, reject) => {
		const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${did}`;
		sendRequest(url)
		.then((text) => {
			const jsonObject = JSON.parse(text);
			let results = [];
			for (const item of jsonObject.feed) {
				let post = postForItem(item, false);
				if (post != null) {
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

