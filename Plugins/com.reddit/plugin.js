// com.reddit

const retiredReason = "Reddit no longer allows access for third-party apps like Tapestry.";

function verify() {
    processError(Error(retiredReason));
}

function load() {
    processError(Error(retiredReason));
}
