
// social.bsky

if (require('bluesky-shared.js') === false) {
    throw new Error("Failed to load bluesky-shared.js");
}

async function verify() {
	const sessionText = await sendRequest(site + "/xrpc/com.atproto.server.getSession");
	const session = JSON.parse(sessionText);
	const username = "@" + session.handle;
	const did = session.did;

	setItem("did", did);
	setItem("didSelf", did);

	const profileText = await sendRequest(site + `/xrpc/app.bsky.actor.getProfile?actor=${did}`);
	const profile = JSON.parse(profileText);
	return {
		displayName: username,
		accountIdentity: Identity.create(profile.displayName, username, profile.avatar)
	};
}

async function load() {
	// NOTE: The timeline will be filled up to the endDate, if possible.
	let endDate = null;
	let endDateTimestamp = getItem("endDateTimestamp");
	if (endDateTimestamp != null) {
		endDate = new Date(parseInt(endDateTimestamp));
	}

	let didSelf = getItem("didSelf");
	if (didSelf == null) {
		didSelf = await getSessionDid();
		setItem("didSelf", didSelf);
	}

	// The timeline and mentions sections are independent of each other, so run them concurrently.
	// The bridge allows multiple in-flight requests per load, and each section delivers its items via
	// processResults() as soon as it finishes. load() returns once all selected sections are done.
	// (The session DID lookup above is a shared prerequisite, and the timeline's internal pagination
	// chains on a cursor — both stay sequential.)
	const tasks = [];

	if (includeHome == "on") {
		tasks.push((async () => {
			const parameters = await queryTimeline(endDate);
			const results = parameters[0];
			const newestItemDate = parameters[1];
			processResults(results);
			if (newestItemDate != null) {
				setItem("endDateTimestamp", String(newestItemDate.getTime()));
			}
		})());
	}

	if (includeMentions == "on" || includeReplies == "on") {
		tasks.push((async () => {
			const results = await queryMentions();
			processResults(results);
		})());
	}

	await Promise.all(tasks);

	// All done — returning from load() ends the load (items were delivered incrementally above).
}

function queryTimeline(endDate) {

	// NOTE: These constants are related to the feed limits within Tapestry - it doesn't store more than
	// 3,000 items or things older than 30 days.
	// The Bluesky API is fast and can return the maximum number of items with 30 seconds, but a week's
	// worth of content feels like a good amount to backfill.
	const maxInterval = 7 * 24 * 60 * 60 * 1000; // days in milliseconds (approximately)
	const maxItems = 1000;

	let newestItemDate = null;
	let oldestItemDate = null;

	return new Promise((resolve, reject) => {

		// this function is called recursively to load & process batches of posts into a single list of results
		function requestToCursor(cursor, endDate, resolve, reject, results = []) {
			let url = null
			if (cursor == null) {
				//console.log("cursor = none");
				url = `${site}/xrpc/app.bsky.feed.getTimeline?algorithm=reverse-chronological&limit=50`;
			}
			else {
				//console.log(`cursor = ${cursor}`);
				url = `${site}/xrpc/app.bsky.feed.getTimeline?algorithm=reverse-chronological&limit=50&cursor=${cursor}`;
			}
			
			console.log(`==== REQUEST cursor = ${cursor}`);
			
			sendRequest(url, "GET")
			.then((text) => {
				//console.log(text);
				let firstId = null;
				let firstDate = null;
				let lastId = null;
				let lastDate = null;
				let endUpdate = false;

				const jsonObject = JSON.parse(text);
				const items = jsonObject.feed
				for (const item of items) {
					const post = postForItem(item, true, null, false);
					if (post != null) {
						results.push(post);
						
						let date = new Date(item.post.indexedAt); // date of the post
						if (item.reason != null && item.reason.$type == "app.bsky.feed.defs#reasonRepost") {
							date = new Date(item.reason.indexedAt); // date of the repost
						}

						const currentId = item.post.uri.split("/").pop();

						if (firstId == null) {
							firstId = currentId;
							firstDate = date;
						}
						lastId = currentId;						
						lastDate = date;
						
						if (!endUpdate && date < endDate) {
							console.log(`>>>> END date = ${date}`);
							endUpdate = true;
						}
						if (date > newestItemDate) {
							console.log(`>>>> NEW date = ${date}`);
							newestItemDate = date;
						}
						if (date < oldestItemDate) {
							console.log(`>>>> OLD date = ${date}`);
							endUpdate = true;
						}

					}
				}
				if (results.length > maxItems) {
					console.log(`>>>> MAX`);
					endUpdate = true;
				}
				
				console.log(`>>>> BATCH results = ${results.length}, lastId = ${lastId}, endUpdate = ${endUpdate}`);
				console.log(`>>>>       first  = ${firstDate}`);
				console.log(`>>>>       last   = ${lastDate}`);
				console.log(`>>>>       newest = ${newestItemDate}`);
				
				const cursor = jsonObject.cursor;			

				if (!endUpdate && cursor != null) {
					requestToCursor(cursor, endDate, resolve, reject, results);
				}
				else {
					resolve([results, newestItemDate]);
				}
			})
			.catch((error) => {
				reject(error);
			});	
		}

		console.log(`>>>> START endDate = ${endDate}`);
		
		let nowTimestamp = (new Date()).getTime();
		let pastTimestamp = (nowTimestamp - maxInterval);
		oldestItemDate = new Date(pastTimestamp);
		console.log(`>>>> OLD date = ${oldestItemDate}`);

		requestToCursor(null, endDate, resolve, reject);
	});
	
}

async function queryMentions() {
	const url = `${site}/xrpc/app.bsky.notification.listNotifications?limit=100`;
	const text = await sendRequest(url);
	const jsonObject = JSON.parse(text);

	let results = [];
	
	if (jsonObject.notifications != null) {
		for (const notification of jsonObject.notifications) {
			if (notification.reason != null) {
				if (includeMentions == "on" && notification.reason == "mention") {
					results.push(postForNotification(notification, "MENTION"));
				}
				if (includeReplies == "on" && notification.reason == "reply") {
					results.push(postForNotification(notification, "REPLY"));
				}
			}
		}
	}

	return results;
}

function postForNotification(notification, annotationLabel) {
    let date = new Date(notification.indexedAt);

    const author = notification.author;
    
    const identity = identityForAccount(author);
    
    let content = contentForRecord(notification.record);
    
    let contentWarning = null;
    if (notification.labels != null && notification.labels.length > 0) {
        const labels = notification.labels.map((label) => { return label?.val ?? "" }).join(", ");
        contentWarning = labels; //`Labeled: ${ labels }`;
    }
    
    let annotation = Annotation.createWithText(annotationLabel);
        
    let attachments = attachmentsForEmbed(notification.record.embed, encodeURIComponent(author.did));
                
    const itemIdentifier = notification.uri.split("/").pop();
    const postUri = uriPrefix + "/profile/" + author.handle + "/post/" + itemIdentifier;
        
    const post = Item.createWithUriDate(postUri, date);
    post.body = content;
    post.author = identity;
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
