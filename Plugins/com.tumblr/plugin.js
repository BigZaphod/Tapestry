
// com.tumblr

if (require('tumblr-shared.js') === false) {
    throw new Error("Failed to load tumblr-shared.js");
}

async function verify() {
    const user = await getUserInfo();
    const blogName = getBlogName(user);
    setItem("blogName", blogName);

    const blogIcon = "https://api.tumblr.com/v2/blog/" + blogName + "/avatar/96";
    const userIcon = "https://api.tumblr.com/v2/blog/" + user.name + "/avatar/96";

    return {
        displayName: blogName,
        icon: blogIcon,
        accountIdentity: Identity.create(user.name, null, userIcon)
    };
}

async function load() {
    let nowTimestamp = (new Date()).getTime();

    let blogName = getItem("blogName");
    if (blogName == null) {
        blogName = getBlogName(await getUserInfo());
        setItem("blogName", blogName);
    }

    // NOTE: The dashboard will be filled up to the endDate, if possible.
    let endDate = null;
    let endDateTimestamp = getItem("endDateTimestamp");
    if (endDateTimestamp != null) {
        endDate = new Date(parseInt(endDateTimestamp));
    }

    const parameters = await queryDashboard(endDate);
    const results = parameters[0];
    const newestItemDate = parameters[1];
    if (newestItemDate) {
        setItem("endDateTimestamp", String(newestItemDate.getTime()));
    }
    return results;
}

async function queryDashboard(endDate) {

    // NOTE: These constants are related to the feed limits within Tapestry - it doesn't store more than
    // 3,000 items or things older than 30 days.
    // In use, the Tumblr API returns a limited number of items (300-ish) over a shorter timespan. Paging back
    // through results (using offset) is fairly slow, and these requests have a 30 second timeout, so the
    // maxInterval is shorter than on other platforms.
    const maxInterval = 1.5 * 24 * 60 * 60 * 1000; // days in milliseconds (approximately)
    const maxItems = 300;

    let newestItemDate = null;
    let oldestItemDate = null;
	
    return new Promise((resolve, reject) => {

        // this function is called recursively to load & process batches of posts into a single list of results
        function requestBatch(id, endDate, pass, resolve, reject, results = []) {
            let url = null
            if (id == null) {
                url = `${site}/v2/user/dashboard?npf=true&reblog_info=true&notes_info=true&limit=20`;
            }
            else {
                const offset = pass * 20;
                url = `${site}/v2/user/dashboard?npf=true&reblog_info=true&notes_info=true&limit=20&offset=${offset}`;
            }

            fetch(url).json()
            .then((jsonObject) => {
                let lastId = null;
                let endUpdate = false;

                const items = jsonObject.response.posts;
                for (const item of items) {
                    const post = postForItem(item);
                    if (post != null) {
                        results.push(post);

                        const date = post.date;
                        lastId = item["id"];

                        if (!endUpdate && date < endDate) {
                            endUpdate = true;
                        }
                        if (date > newestItemDate) {
                            newestItemDate = date;
                        }
                        if (date < oldestItemDate) {
                            endUpdate = true;
                        }
                    }
                }

                if (id == lastId) {
                    endUpdate = true;
                }
                if (pass >= 20) {
                    endUpdate = true;
                }
                if (results.length > maxItems) {
                    endUpdate = true;
                }

                if (!endUpdate && lastId != null) {
                    requestBatch(lastId, endDate, pass + 1, resolve, reject, results);
                }
                else {
                    resolve([results, newestItemDate]);
                }
            })
            .catch((error) => {
                reject(error);
            });	
        }

        let nowTimestamp = (new Date()).getTime();
        let pastTimestamp = (nowTimestamp - maxInterval);
        oldestItemDate = new Date(pastTimestamp);
			
        requestBatch(null, endDate, 0, resolve, reject);
    });
	
}
