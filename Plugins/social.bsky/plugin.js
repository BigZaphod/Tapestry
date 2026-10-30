
// social.bsky

if (require('bluesky-shared.js') === false) {
    throw new Error("Failed to load bluesky-shared.js");
}

async function verify() {
    const session = await fetch(site + "/xrpc/com.atproto.server.getSession").json();
    // The full handle is kept for accountIdentity so the timeline's "via" label can still disambiguate
    // accounts when needed; the feed name uses the shortened form.
    const fullUsername = "@" + session.handle;
    const username = "@" + shortHandle(session.handle);
    const did = session.did;

    setItem("did", did);
    setItem("didSelf", did);

    const profile = await fetch(site + `/xrpc/app.bsky.actor.getProfile?actor=${did}`).json();
    return {
        displayName: username,
        accountIdentity: Identity.create(profile.displayName, fullUsername, profile.avatar)
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

    // The sections are independent, so run them concurrently — each delivers its items via processResults() as it
    // finishes. (The session DID lookup above is a shared prerequisite, and each section's cursor pagination chains —
    // both stay sequential.)
    const tasks = [];
    // Reference points to store once the whole load has succeeded: a failed load's results are thrown away, so storing
    // one sooner would skip what it covered.
    const advances = [];

    if (includeHome == "on") {
        tasks.push((async () => {
            const parameters = await queryTimeline(endDate);
            const results = parameters[0];
            const newestItemDate = parameters[1];
            processResults(results);
            if (newestItemDate != null) {
                advances.push(["endDateTimestamp", String(newestItemDate.getTime())]);
            }
        })());
    }

    // Activity is always returned, whatever the switches above say: they decide what the timeline shows, and
    // someone who keeps mentions out of their timeline still expects them in Activity.
    tasks.push(queryNotifications(conversationReasons, "conversationsNewestDate", advances));
    tasks.push(queryNotifications(reactionReasons, "reactionsNewestDate", advances));

    await Promise.all(tasks);

    for (const [key, value] of advances) {
        setItem(key, value);
    }

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
			
            fetch(url).json()
            .then((jsonObject) => {
                let firstId = null;
                let firstDate = null;
                let lastId = null;
                let lastDate = null;
                let endUpdate = false;

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

// Requested apart, each with its own reference point, so a flood of likes can only cost likes, never a reply. A
// reason is also its activity type's id.
const conversationReasons = ["mention", "reply", "quote"];
const reactionReasons = ["like", "repost", "follow", "like-via-repost", "repost-via-repost"];

// How many to take in one load, and how far back a new feed reaches.
const notificationCap = 800;
const notificationMaxAge = 30 * 24 * 60 * 60 * 1000;

// Newest first, back to the stored date: Bluesky's cursors only go backward. It all arrives in one load, so a reader
// catching up has no hole above them; only a backlog past the cap loses anything, its oldest.
async function fetchNotifications(reasons, key) {
    const stored = getItem(key);
    const oldest = stored != null ? parseInt(stored) : Date.now() - notificationMaxAge;
    const query = reasons.map((reason) => `reasons=${reason}`).join("&");
    const url = `${site}/xrpc/app.bsky.notification.listNotifications?limit=100&${query}`;

    const notifications = [];
    let newestDate = stored;
    let cursor = null;
    while (notifications.length < notificationCap) {
        const page = await fetch(cursor != null ? `${url}&cursor=${encodeURIComponent(cursor)}` : url).json();
        const batch = page.notifications ?? [];
        if (batch.length == 0) {
            break;
        }
        if (cursor == null) {
            newestDate = String(new Date(batch[0].indexedAt).getTime());
        }
        const fresh = batch.filter((notification) => new Date(notification.indexedAt).getTime() >= oldest);
        notifications.push(...fresh);
        if (fresh.length < batch.length || page.cursor == null) {
            break;
        }
        cursor = page.cursor;
    }
    return { notifications, newestDate };
}

// The post an event is about: the notification's own record for a post written to you, the record's subject otherwise.
// Follows are about no post.
function subjectUri(notification) {
    if (notification.reason == "follow") {
        return null;
    }
    return conversationReasons.includes(notification.reason) ? notification.uri : notification.record?.subject?.uri;
}

async function queryNotifications(reasons, key, advances) {
    const { notifications, newestDate } = await fetchNotifications(reasons, key);

    // A notification carries only the bare record — no viewer state, no counts — so the post's actions can't be built
    // from it. Hydrate the posts and build them exactly like timeline items.
    const views = await postViewsForUris(notifications.map(subjectUri).filter((uri) => uri != null));

    const results = [];
    for (const notification of notifications) {
        const activity = activityForNotification(notification, views);
        if (activity != null) {
            results.push(activity);
        }
        const view = views.get(notification.uri);
        const showsInTimeline = (notification.reason == "mention" && includeMentions == "on") || (notification.reason == "reply" && includeReplies == "on");
        if (showsInTimeline && view != null) {
            const post = postForItem({ post: view }, true);
            if (post != null) {
                post.annotations = [Annotation.createWithText(notification.reason.toUpperCase())];
                results.push(post);
            }
        }
    }
    processResults(results);
    if (newestDate != null) {
        advances.push([key, newestDate]);
    }
}

function activityForNotification(notification, views) {
    const author = identityForAccount(notification.author);
    if (author == null) {
        return null;
    }
    // Bluesky places a post at the EARLIER of when it was indexed and the record's date (see `postForItem`).
    const indexedAt = new Date(notification.indexedAt);
    const createdAt = new Date(notification.record?.createdAt ?? notification.indexedAt);
    const activity = Activity.create(notification.reason, notification.uri, createdAt < indexedAt ? createdAt : indexedAt);
    activity.author = author;
    if (notification.author.description != null && notification.author.description.length > 0) {
        activity.author.description = notification.author.description;
    }
    const uri = subjectUri(notification);
    if (notification.reason != "follow") {
        // Gone since the notification fired, or blocked: there's nothing to show.
        const view = uri != null ? views.get(uri) : null;
        const post = view != null ? postForItem({ post: view }, true) : null;
        if (post == null) {
            return null;
        }
        // A Bluesky reply needn't contain your name, so nothing else in the post says it's to you.
        if (conversationReasons.includes(notification.reason)) {
            post.annotations = [Annotation.createWithText(notification.reason.toUpperCase())];
        }
        activity.subject = post;
    }
    return activity;
}
