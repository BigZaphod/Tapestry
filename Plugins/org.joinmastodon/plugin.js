
// org.joinmastodon

if (require('mastodon-shared.js') === false) {
    throw new Error("Failed to load mastodon-shared.js");
}

async function verify() {
    const jsonObject = await fetch(site + "/api/v1/accounts/verify_credentials").json();

    const instance = site.split("/")[2] ?? "";
    const accountName = jsonObject["display_name"];
    const username = "@" + jsonObject["username"];
    // The instance-qualified handle is kept for accountIdentity so the timeline's "via" label can still
    // tell apart two accounts with the same username on different instances. The feed name itself uses the
    // short form, since that disambiguation is only needed in that one spot.
    const fullUsername = username + "@" + instance;
    const icon = jsonObject["avatar"];

    const userId = jsonObject["id"];
    setItem("userId", userId);

    return {
        displayName: username,
        accountIdentity: Identity.create(accountName, fullUsername, icon)
    };
}

var userId = getItem("userId");

// Storage is per device, so a feed synced from another device has no userId until something fetches it. Called before
// load builds items, and by performAction (mastodon-shared.js) when it's defined, as it is only for the connector that
// has an account of its own.
async function ensureAccountIdentity() {
    if (getItem("userId") == null) {
        setItem("userId", (await fetch(site + "/api/v1/accounts/verify_credentials").json())["id"]);
    }
}

async function fetchFollowedTags() {
    try {
        const jsonArray = await fetch(`${site}/api/v1/followed_tags?limit=400`).json();
        return jsonArray.map(tag => tag.name.toLowerCase());
    }
    catch (error) {
        console.log(`fetchFollowedTags failed: ${error}`);
        return [];
    }
}

async function load() {
    // Resolve once, up front: whether this (authenticated) instance supports authoring quote posts (Mastodon 4.5+ /
    // API v7), into the module-level `quoteCapable` that postForItem reads. getInstance() is cached for a week once a
    // load succeeds.
    quoteCapable = supportsQuotePosts(await getInstance());

    // Ensure userId BEFORE any section builds items, not lazily in the statuses section: postForItem gates the
    // own-post actions (edit/delete) on it, and the sections run concurrently — home items built while a wiped
    // userId was still being re-fetched would import without those actions. Storage is wiped by the app's
    // Clear Cache (it removes the feed's whole key/value domain), so this isn't a once-ever situation.
    await ensureAccountIdentity();
    userId = getItem("userId");

    // NOTE: The home timeline will be filled up to the endDate, if possible.
    let endDate = null;
    let endDateTimestamp = getItem("endDateTimestamp");
    if (endDateTimestamp != null) {
        endDate = new Date(parseInt(endDateTimestamp));
    }

    // The sections are independent, so run them concurrently — each delivers its items via
    // processResults() as it finishes. (Within a section, ordering-dependent work — followed tags before the
    // home query, home pagination — stays sequential.)
    const tasks = [];
    // Each section stores its reference point when it finishes. What load stores is kept only once its items are saved,
    // so items that are lost are fetched again.

    if (includeHome == "on") {
        tasks.push((async () => {
            console.log(`==== HOME START`);
            const followedTagNames = await fetchFollowedTags();
            const parameters = await queryHomeTimeline(endDate, followedTagNames);
            const results = parameters[0];
            const newestItemDate = parameters[1];
            processResults(results);
            if (newestItemDate) {
                setItem("endDateTimestamp", String(newestItemDate.getTime()));
            }
            console.log(`==== HOME END`);
        })());
    }

    if (includeStatuses == "on") {
        tasks.push((async () => {
            console.log(`==== STATUSES START`);
            const results = await queryStatusesForUser(userId);
            console.log(`==== STATUSES END results = ${results.length}`);
            processResults(results);
            console.log(`==== STATUSES DONE`);
        })());
    }

    // Activity is always returned, whatever the switches above say: they decide what the timeline shows, and
    // someone who keeps mentions out of their timeline still expects them in Activity.
    tasks.push(queryNotifications(conversationTypes, "conversationsNewestId"));
    tasks.push(queryNotifications(reactionTypes, "reactionsNewestId"));

    await Promise.all(tasks);

    // Returning ends the load: what processResults collected goes to the app as one batch.
    console.log(`==== LOAD COMPLETE`);
}

function queryHomeTimeline(endDate, followedTagNames) {

    // NOTE: These constants are related to the feed limits within Tapestry - it doesn't store more than
    // 3,000 items or things older than 30 days.
    // In use, the Mastodon API returns a limited number of items (800-ish) over a shorter timespan.
    const maxInterval = 3 * 24 * 60 * 60 * 1000; // days in milliseconds (approximately)
    const maxItems = 800;

    let newestItemDate = null;
    let oldestItemDate = null;
	
    return new Promise((resolve, reject) => {

        // this function is called recursively to load & process batches of posts into a single list of results
        function requestToId(id, endDate, resolve, reject, results = []) {
            let url = null
            if (id == null) {
                url = `${site}/api/v1/timelines/home?limit=40`;
            }
            else {
                url = `${site}/api/v1/timelines/home?limit=40&since_id=1&max_id=${id}`;
            }
			
            console.log(`==== REQUEST id = ${id}`);
			
            fetch(url).json()
            .then((jsonObject) => {
                let lastId = null;
                let lastDate = null;
                let endUpdate = false;
                for (const item of jsonObject) {
                    const date = new Date(item["created_at"]);

                    let post = null;
                    if (item.reblog != null && includeBoosts != "on") {
                        // skip boosts
                    }
                    else if (item.quote != null && includeQuotes != "on") {
                        // skip quotes
                    }
                    else if (includeRepliesToOthers != "on" && item.in_reply_to_id != null && item.in_reply_to_account_id != item.account.id && item.in_reply_to_account_id != userId) {
                        // skip replies to others (Mastodon only sends replies between people you follow, but
                        // Akkoma/Pleroma send every reply from people you follow unless asked otherwise)
                    }
                    else {
                        post = postForItem(item);
                    }

                    // Annotate or filter posts from followed hashtags
                    if (post != null && item.reblog == null && followedTagNames.length > 0) {
                        const itemTags = item.tags;
                        if (itemTags != null && itemTags.length > 0) {
                            const matchedTag = itemTags.find(t => followedTagNames.includes(t.name.toLowerCase()));
                            if (matchedTag != null) {
                                if (includeFollowedHashtags != "on") {
                                    post = null;
                                }
                                else {
                                    let annotation = Annotation.createWithText(`#${matchedTag.name.toUpperCase()}`);
                                    annotation.uri = `${site}/tags/${matchedTag.name.toLowerCase()}`;
                                    post.annotations = [annotation].concat(post.annotations ?? []);
                                }
                            }
                        }
                    }

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
					
                    if (post != null) {
                        results.push(post);
                    }
		
                    lastId = item["id"];
                    lastDate = date;
                }

                if (results.length > maxItems) {
                    console.log(`>>>> MAX`);
                    endUpdate = true;
                }
				
                console.log(`>>>> BATCH results = ${results.length}, lastId = ${lastId}, endUpdate = ${endUpdate}`);
                console.log(`>>>>       last   = ${lastDate}`);
                console.log(`>>>>       newest = ${newestItemDate}`);
				
                // NOTE: endUpdate signifies a date or count threshold has been reached, lastId indicates the API returned no items.
                if (!endUpdate && lastId != null) {
                    requestToId(lastId, endDate, resolve, reject, results);
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
			
        requestToId(null, endDate, resolve, reject);

    });
	
}

// Mastodon notification types → activities.json type ids. A mention that replies to one of your posts is a reply.
const activityTypes = {
    mention: "mention",
    quote: "quote",
    favourite: "favorite",
    reblog: "boost",
    follow: "follow",
    follow_request: "follow-request"
};

// Requested apart, each with its own reference point, so a flood of likes can only delay likes, never a reply or a follow
// request. Mastodon ignores a type it doesn't know (`quote` is 4.5+).
const conversationTypes = ["mention", "quote", "follow_request"];
const reactionTypes = ["favourite", "reblog", "follow"];

// How many to take in one load. A catch-up past this finishes on later loads, with no hole.
const notificationCap = 800;
const notificationMaxAge = 30 * 24 * 60 * 60 * 1000;

// Ids are ordered, and a later one is never shorter. Mastodon's are numbers; some servers' aren't.
function isIdAfter(id, other) {
    return id.length != other.length ? id.length > other.length : id > other;
}

// Every load reads the newest page, and that's all of it when the page reaches the reference point: anything missed that's
// still in the page comes back, whatever the reason, and what's already here collapses by id. A longer backlog reads
// forward from the reference point instead, oldest first: someone catching up reads on from where they were, so nothing
// may be missing above them. Without one, a new feed, newest first, as far back as Tapestry keeps: no one's reading yet.
async function fetchNotifications(types, key) {
    const stored = getItem(key);
    const query = types.map(type => `types%5B%5D=${type}`).join("&");
    const url = `${site}/api/v1/notifications?limit=80&${query}`;
    const oldest = Date.now() - notificationMaxAge;

    if (stored != null) {
        const latest = await fetch(url).json();
        if (latest.length < 80 || !isIdAfter(latest[latest.length - 1].id, stored)) {
            return { notifications: latest, newestId: latest[0]?.id ?? stored };
        }
    }

    let notifications = [];
    let newestId = stored;
    let cursor = stored;
    while (notifications.length < notificationCap) {
        const page = await fetch(stored != null ? `${url}&min_id=${cursor}` : (cursor != null ? `${url}&max_id=${cursor}` : url)).json();
        if (page.length == 0) {
            break;
        }
        notifications.push(...page);
        // Either way a page is newest first.
        if (stored != null) {
            cursor = newestId = page[0].id;
        }
        else {
            newestId = newestId ?? page[0].id;
            cursor = page[page.length - 1].id;
            if (new Date(page[page.length - 1].created_at).getTime() < oldest) {
                break;
            }
        }
        if (page.length < 80) {
            break;
        }
    }
    return { notifications, newestId };
}

async function queryNotifications(types, key) {
    const { notifications, newestId } = await fetchNotifications(types, key);
    const results = [];
    for (const notification of notifications) {
        const activity = activityForNotification(notification);
        if (activity != null) {
            results.push(activity);
        }
        if (includeMentions == "on" && notification.type == "mention" && notification.status != null) {
            results.push(postForItem(notification.status));
        }
    }
    console.log(`==== NOTIFICATIONS ${key} results = ${results.length}`);
    processResults(results);
    if (newestId != null) {
        setItem(key, newestId);
    }
}

function activityForNotification(notification) {
    let type = activityTypes[notification.type];
    if (type == null) {
        return null;
    }
    const status = notification.status;
    if (type == "mention" && status != null && status.in_reply_to_account_id == userId) {
        type = "reply";
    }
    // Every type but the follows is about a post; one that arrives without it has nothing to show.
    const isFollow = (type == "follow" || type == "follow-request");
    if (!isFollow && status == null) {
        return null;
    }

    // A follow is keyed by who followed, so the one accepting a request returns is this one (`answerFollowRequest`).
    const uri = (type == "follow") ? notification.account.id : notification.id;
    const activity = Activity.create(type, uri, new Date(notification.created_at));
    activity.author = identityForAccount(notification.account);
    activity.author.description = accountCounts(notification.account);
    // The author's display_name may have custom emoji.
    activity.shortcodes = {};
    for (const emoji of notification.account.emojis ?? []) {
        activity.shortcodes[emoji.shortcode] = emoji.static_url;
    }
    if (!isFollow) {
        const post = postForItem(status);
        // Says what the event is, as Bluesky's do. PRIVATE MENTION already does, and who can see it matters more.
        if (["mention", "reply", "quote"].includes(type) && status.visibility != "direct") {
            post.annotations = [Annotation.createWithText(type.toUpperCase())].concat(post.annotations ?? []);
        }
        activity.subject = post;
    }
    if (type == "follow-request") {
        activity.actions.add("authorize");
        activity.actions.add("reject");
        activity.metadata.accountId = notification.account.id;
    }
    return activity;
}

function identityForAccount(account) {
    const identity = Identity.createWithName(account.display_name ? account.display_name : account.username);
    identity.username = "@" + account.acct;
    identity.uri = account.url;
    identity.avatar = account.avatar;
    return identity;
}

// "1,204 followers · 83 posts": enough to decide about someone who followed or reacted, on one short line.
function accountCounts(account) {
    const count = (number, one, many) => `${number.toLocaleString()} ${number == 1 ? one : many}`;
    const counts = [];
    if (account.followers_count != null) {
        counts.push(count(account.followers_count, "follower", "followers"));
    }
    if (account.statuses_count != null) {
        counts.push(count(account.statuses_count, "post", "posts"));
    }
    return counts.length > 0 ? counts.join(" · ") : null;
}

async function queryStatusesForUser(id) {
    const jsonObject = await fetch(site + "/api/v1/accounts/" + id + "/statuses?limit=40").json();
    let results = [];
    for (const item of jsonObject) {
        if (item.reblog != null && includeBoosts != "on") {
            continue;
        }
        if (item.quote != null && includeQuotes != "on") {
            continue;
        }
        results.push(postForItem(item));
    }
    return results;
}
