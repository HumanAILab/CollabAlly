//////////////////////////////////////////////////////////////////////////////////////////////
/// WEB SOCKET IMPLEMENTATION
//////////////////////////////////////////////////////////////////////////////////////////////
const host_ipv4= "https://collabally.humanailab.com:443"
// const host_ipv4 = "https://35.223.209.32:443"
// const host_ipv4 = "http://10.0.0.191:5000"
var socket;
var socketReady = false;
var TTSPlaying = false;

// Initialize the comparison procedure
function initializeComparison() {
    chrome.runtime.sendMessage({
        message: "getCollaborators"
    });
}

// Set time interval for comparing every N seconds
const delay = 3000;
var compare;

//////////////////////////////////////////////////////////////////////////////////////////////
/// UTILITY FUNCTIONS: COLLABORATOR STATE
//////////////////////////////////////////////////////////////////////////////////////////////
// When we get 2 html elements in the doc, find their lowest common ancestor
/**
 * Helper function to detect the LCA of 2 HTML Nodes
 * @param {*} node1 
 * @param {*} node2 
 * @returns LCA of the two nodes (undefined otherwise)
 */
function findLCA(node1, node2) {
    for(;node1;node1 = node1.parentNode){
        if(node1.contains(node2)){
           return node1;
       }
    }
}

// Keep track of current cursor position
selfCursorPos = {};

// Collaborators state
var collabState = {};

// Change Summary of the collaborators
var collabChangeSummary = {};

// Array of available country codes
let anonymousCount = 0;
let voiceFonts = ['GB', 'US', 'AU', 'IN']
let voiceFontMap = {
    "Cheuk Yin Lee": {region: "US", voice: "en-US-Wavenet-I"},
    "Jaylin Herskovitz": {region: "US", voice: "en-US-Wavenet-F"},
    "Zhuohao Zhang": {region: "US", voice: "en-US-Wavenet-B"},
    "Anhong Guo": {region: "US", voice: "en-US-Wavenet-D"},
    "Renee Jones": {region: "AU", voice: "en-AU-Standard-C"},
    "Marcos Valdez": {region: "GB", voice: "en-GB-Standard-D"}
}

// Array where each element represents the HTML elements in 1 page of the google doc (used for finding collaborators)
var docHTMLElementMap = [];
var docHTMLContextJSON = [];

/**
 * Helper function to get the most updated version of the HTML document by tracking the document state
 */
function getUpdatedDoc() {
    // All the pages for the google doc
    docHTMLElementMap.splice(0, docHTMLElementMap.length);
    docHTMLContextJSON.splice(0, docHTMLContextJSON.length);
    // var doc_pages = document.getElementsByClassName("kix-page kix-page-header-clip-enabled docs-page docs-page-portrait kix-page-paginated");
    var doc_pages = document.getElementsByClassName("kix-page-paginated");

    // For each page, get the spans in each page
    for (let i = 0; i < doc_pages.length; i++) {
        // console.log("Page number ", i, " with elements: ", doc_pages[i]);
        docHTMLElementMap.push({top: $(doc_pages[i]).offset().top, text: []});
        docHTMLContextJSON[i] = [];

        var page_text = doc_pages[i].getElementsByClassName("kix-wordhtmlgenerator-word-node");
        for (let j = 0; j < page_text.length; j++) {
            let elementObj = {
                top: $(page_text[j]).offset().top,
                element: page_text[j],
            };

            // console.log("Page Element: ", elementObj);
            docHTMLElementMap[i].text.push(elementObj);
            docHTMLContextJSON[i].push(page_text[j].innerText);
        }
    }

    // console.log("Final State: ", docHTMLElementMap);
}

// Find the element on the cursor based on Y Offset
/**
 * Get the offset of the element based on cursor position
 * @param {*} cursorYOffset 
 * @returns JSON object describing which element the cursor is located on
 */
function findCursorElement(cursorYOffset) {
    // Going backwards
    // console.log("Cursor top position: ", cursorYOffset);
    for (var i = docHTMLElementMap.length - 1; i >= 0; i--) {
        // If it is greater than the top element, then the cursor is on this page
        if (cursorYOffset > docHTMLElementMap[i].top) {
            for (var j = 0; j < docHTMLElementMap[i].text.length; j++) {
                if (Math.abs(docHTMLElementMap[i].text[j].top - cursorYOffset) <= 5) {
                    return {page: i+1, 
                            element: docHTMLElementMap[i].text[j].element,
                            index_ratio: j/docHTMLElementMap[i].text.length};
                }
            }
        }
    }
    return {};
}

// Get the state of the collaborators in the document
/**
 * Get the collaborator states from the URL
 * @param {String} url String of the URL
 * @returns The object based representation of the collaborator states
 */
function getCollabStates(url) {
    if (url.indexOf("https://docs.google.com") != -1) {
        // First update the doc state to track where all the elements are
        getUpdatedDoc();

        // Get the width of the document and determine the ratio for it
        var docWidth = document.getElementsByClassName("kix-zoomdocumentplugin-outer")[0];
        var docHeight = document.getElementsByClassName("kix-page-paginated")[0];

        // And then fetch all the cursors and their positions in the doc
        var collaborator_cursors = document.getElementsByClassName("kix-cursor docs-ui-unprintable");
        var collaborator_names = [];
        var collaborator_levels = {};

        for (var i = 0; i < collaborator_cursors.length; i++) {
            var cursor_name = collaborator_cursors[i].getElementsByClassName("kix-cursor-name")[0].innerText;
            
            if (cursor_name === "") 
                cursor_name = "Self";

            var element = findCursorElement($(collaborator_cursors[i]).offset().top);
            if ("element" in element) {
                collaborator_levels[cursor_name] = {
                    // "pos": {"x": ($(collaborator_cursors[i]).offset().left - docWidth.offsetLeft)/docWidth.clientWidth, 
                    //         "y": ($(collaborator_cursors[i]).offset().top - docHeight.offsetTop)/docHeight.clientHeight},
                    "pos": {"x": (parseFloat($(collaborator_cursors[i]).css("left")) - docWidth.offsetLeft)/docWidth.clientWidth,
                            "y": (parseFloat($(collaborator_cursors[i]).css("top")) - docWidth.offsetTop)/docHeight.clientHeight},
                    "element": element.element,
                    "page": element.page,
                    "context": element.index_ratio > 0.6 ? "bottom" :  element.index_ratio > 0.3 ? "center" : "top",
                    "text": element.element.innerText
                }

                if (cursor_name === "Self") {
                    selfCursorPos = collaborator_levels["Self"]["pos"];
                }
            }
            // console.log(collaborator_levels);
        }

        for (var i = 0; i < collaborator_levels.length; i++) {
            for (var j = 0; j < collaborator_levels.length; j++) {
                if (i !== j) {
                    var LCA = findLCA(collaborator_levels[i], collaborator_levels[j]);
                    // Store it as a N*N matrix and send it via WebSocket
                    console.log(collaborator_names[i], collaborator_names[j], "They are under the same: ", LCA);
                }
            }
        }

        // console.log(collaborator_levels);
        return collaborator_levels
    }
    else return {};
}

/**
 * Compare the different states between the new collaborator state and the existing one
 * @param {*} map1 Old State
 * @param {*} map2 New State
 * @returns JSON Object of all the changed states
 */
function compareMaps(map1, map2) {
    let whitelist = ["id", "tagName", "className", "innerText"];
    var newCollaborators = [];
    var leftCollaborators = [];
    var idleCollaborators = [];
    var inactiveCollaborators = []; // These are for those who are by default inactive when user enters the scene

    var movedCollaborators = [];

    let onlineCollabs = document.getElementsByClassName("docs-presence-plus-collab-widget-container goog-inline-block docs-presence-plus-collab-widget-focus");
    for (const [key, value] of Object.entries(map1)) {
        if (key in map2) {
            if (!value["element"].isSameNode(map2[key]["element"]) && key !== "Self") {
                movedCollaborators.push({
                    "collaborator": key,
                    "from": {"pos": value["pos"], 
                            "element": JSON.stringify(value["element"], whitelist),
                            "page": value["page"],
                            "context": value["context"],
                            "text": value["text"]},
                    "location": {"pos": map2[key]["pos"], 
                                "element": JSON.stringify(map2[key]["element"], whitelist),
                                "page": value["page"],
                                "text": value["text"],
                                "context": value["context"]}
                })
            }
        }
        else {
            // Update: We also track the idle collaborators to report that back to the user
            let isIdle = false;
            for (const collab of onlineCollabs) {
                let collab_name = collab.getAttribute("aria-label");
                if (collab_name.includes(key) && collab_name.includes("(idle)") && key !== "Self") {
                    idleCollaborators.push({
                        "collaborator": key,
                        "location": {"pos": value["pos"], 
                                    "element": JSON.stringify(value["element"], whitelist),
                                    "page": value["page"],
                                    "text": value["text"],
                                    "context": value["context"]}
                    })
                    isIdle = true;
                    break;
                }
            }

            if (!isIdle && key !== "Self") {
                leftCollaborators.push({
                    "collaborator": key,
                    "location": {"pos": value["pos"], 
                                "element": JSON.stringify(value["element"], whitelist),
                                "page": value["page"],
                                "text": value["text"],
                                "context": value["context"]}
                })
            }
        }
    }

    // Get new collaborators from new state
    for (const [key, value] of Object.entries(map2)) {
        if (!(key in map1) && key !== "Self") {
            newCollaborators.push({
                "collaborator": key,
                "location": {"pos": value["pos"], 
                            "element": JSON.stringify(value["element"], whitelist),
                            "page": value["page"],
                            "text": value["text"],
                            "context": value["context"]}
            })
        }
    }

    // Check idle collaborators
    for (const collab of onlineCollabs) {
        let collab_name = collab.getAttribute("aria-label");
        // console.log("Collab Name: ", collab_name)
        if (collab_name.includes("(idle)")) {
            let isAdded = false;
            idleCollaborators.forEach(idle => {
                if (collab_name.includes(idle["collaborator"])) {
                    isAdded = true;
                }
            })

            if (!isAdded) {
                inactiveCollaborators.push({
                    "collaborator": collab_name.split("(idle)")[0]
                })
            }
        }
    }

    return {
        "new": newCollaborators,
        "moved": movedCollaborators,
        "left": leftCollaborators,
        "idle": idleCollaborators,
        "inactive": inactiveCollaborators, // same as idle, but for those who never were active in the first place
        "all": {}
    }
}

/**
 * 
 * @param {*} levels 
 * @returns 
 */
function getContext(levels) {
    context = {};
    for (const [key, value] of Object.entries(levels)) {
        var count = 0;
        var temp = value["element"]
        // console.log(key, value);
        while (temp.previousSibling === null || temp.previousSibling.innerText == "") {
            // console.log(count, temp)
            count++;
            if (count > 7 || temp.parentNode == null) break;
            temp = temp.parentNode;
        }
        var last = "";
        if (temp.previousSibling !== null) last = temp.previousSibling.innerText;
        count = 0;
        temp = value["element"];
        while (temp.nextSibling == null || temp.nextSibling.innerText == "") {
            count++;
            if (count > 7 || temp.parentNode == null) break;
            temp = temp.parentNode;
        }
        var next = "";
        if (temp.nextSibling !== null) next = temp.nextSibling.innerText;
        context[key] = {
                "last": last,
                "next": next
        }
    }
    return context;
}

//////////////////////////////////////////////////////////////////////////////////////////////
/// UTILITY FUNCTIONS: COLLABORATOR COMMENTS
//////////////////////////////////////////////////////////////////////////////////////////////
// Comment map that keeps track of the states of comments per user (all comments)
let commentMap = {}
let currentMap = {}

let totalCommentBlocks = 1; // Used to assign an id for the comments
let commentThreadElementMap = {}; // Used to map id back to element in HTML

// State machine for newly added comments (for sending to server for TTS summaries)
let newComments = {}
let newReplies = {}

// Unread array until they are sent to python server for TTS
let unreadComments = []
let unreadReplies = []

/**
 * Function to get the comments in the document and update comment map
 * @param {String} url URL of the document
 */
function getCollabComments(url) {
    // Check if it's a Google doc
    if (url.indexOf("https://docs.google.com") != -1) {
        // Class of objects that are possible comments
        // let commentDiv = document.getElementsByClassName("docos-anchoreddocoview-content docos-docoview-replycontainer");
        let commentDiv = document.getElementsByClassName("docos-docoview-tesla-conflict docos-docoview-resolve-button-visible docos-anchoreddocoview");
        // console.log("Found comments ", commentDiv);

        // Class of highlighted text elements
        //kix-commentoverlayrenderer-normal kix-htmloverlay docs-ui-unprintable kix-htmloverlay-under-text
        let highlightedDiv = document.getElementsByClassName("kix-htmloverlay docs-ui-unprintable kix-htmloverlay-under-text");

        //kix-commentoverlayrenderer-highlighted
        //kix-commentoverlayrenderer-normal 

        const docHeight = document.getElementsByClassName("kix-page-paginated")[0];

        // Iterate through the list of comments
        for (const comment of commentDiv) {
            // Get the corresponding commented block that is closest to the current highlighted text
            let closestHighlightBlock = null;
            let commentBlockTopOffset = Infinity;
            let distance = Infinity;
            let selectedText = null;
            let closestCommentBlock = comment.getElementsByClassName("docos-anchoreddocoview-content docos-docoview-replycontainer")[0];

            for (const highlight of highlightedDiv) {
                // console.log("Highlight: ", highlight);
                // Get the corresponding <span> class that maps to this specific highlighted div
                
                let tempDist = Math.abs(highlight.getBoundingClientRect().top - parseFloat($(comment).css("top")));
                if (tempDist <= distance) {
                    distance = tempDist;
                    
                    commentBlockTopOffset = (parseFloat($(comment).css("top")) - docHeight.offsetTop)/docHeight.clientHeight;
                    closestHighlightBlock = highlight;
                    selectedText = highlight.parentElement.getElementsByClassName("kix-lineview-content");
                }
            }

            if (closestHighlightBlock) {
                // console.log("Closest Highlight Block: ", closestHighlightBlock);
                // console.log("Closest Comment Block Bounding Rectangle: ", closestCommentBlock.getBoundingClientRect())
                const rootBlock = closestCommentBlock.getElementsByClassName("docos-docoview-rootreply")[0];
                let rootComment = rootBlock.getElementsByClassName("docos-replyview-body")[0];
                let rootTime = rootBlock.getElementsByClassName("docos-replyview-timestamp")[0];
                let rootAuthor = rootBlock.getElementsByClassName("docos-author")[0];

                // console.log("Root Block: ", rootComment, " Root Time: ", rootTime, " Root Author: ", rootAuthor);
                // By default, i = 0 is root block
                for (var i = 0; i < closestCommentBlock.childNodes.length; i++) {
                    let textBlock = closestCommentBlock.childNodes[i];
                    let author = textBlock.getElementsByClassName("docos-author")[0];
                    let timestamp = textBlock.getElementsByClassName("docos-replyview-timestamp")[0];
                    let commentText = textBlock.getElementsByClassName("docos-replyview-body")[0];


                    // console.log("Text Block: ", textBlock);
                    // console.log("Text: ", selectedText, " Author: ", author, " Time: ", timestamp, " Body: ", commentText);
                    if (i === 0) {
                        // Root Comment Block
                        if (author !== null && commentText !== null && selectedText[0] !== undefined && timestamp !== null) {
                            let time = timestamp.innerText;
                            if (time.includes("New")) {
                                time = time.split("New")[0];
                            }

                            let location = getCommentLocation(selectedText[0].innerText);
                            // console.log(location);

                            updateCommentMap(author.innerText, commentText.innerText, selectedText[0].innerText, time, rootBlock, selectedText[0], commentBlockTopOffset, location);
                        }
                    }
                    else {
                        // Reply Comment Block
                        if (author !== null && commentText !== null && selectedText[0] !== undefined && timestamp !== null && rootAuthor !== null) {
                            let time = timestamp.innerText;
                            if (time.includes("New")) {
                                time = time.split("New")[0];
                            }

                            let root = rootTime.innerText;
                            if (root.includes("New")) {
                                root = root.split("New")[0];
                            }

                            updateCommentReply(author.innerText, commentText.innerText, time, {author: rootAuthor.innerText, comment: rootComment.innerText, time: root})
                        }
                    }
                }
            }
            else {
                // console.log("No Closest highlight block...", selectedText);
            }
        }
    }

    // console.log("Current Comment Map: ", currentMap);
}

function getCommentLocation(docText) {
    let result = {location: "Top", number: 1};
    // console.log("Doc Context: ", docHTMLContextJSON, " Text: ", docText);
    docHTMLContextJSON.forEach((page, i) => {
        page.forEach((line, j) => {
            if (line === docText) {
                    // console.log("Matched: ", line);
                    let location = "Bottom";
                    if (j/page.length < 0.3)
                        location = "Top";
                    else if (j/page.length < 0.6)
                        location = "Center";

                    result = {location: location, number: i+1};
            }
        })
    })

    return result;
}

/**
 * Helper function to update the comments that is being detected by our extension chrome
 * @param {String} author 
 * @param {String} comment 
 * @param {String} docText 
 * @param {String} time 
 * @param {String} reply The replies to these comments
 */
function updateCommentMap(author, comment, docText, time, element, textElement, distance, location) {
    let commentObj = {
        id: totalCommentBlocks,
        html: textElement,
        comment: comment,
        time: time,
        scroll: {x: 1, y: distance},
        page: location,
        docText: [docText],
        reply: []
    }

    // console.log("Author: ", author, " comment: ", commentObj);
    if (author in currentMap) {
        let multilineComment = false, existInMap = false;
        for (let i = 0; i < currentMap[author].length; i++) {
            let authorComment = currentMap[author][i];

            // console.log("Author Comment: ", authorComment, "Comment: ", comment, "Time: ", time);
            if (authorComment.comment === comment && authorComment.time === time) {
                for (let j = 0; j < authorComment.docText.length; j++) {
                    const text = authorComment.docText[j];
                    if (text === docText) {
                        //console.log("Match: ", docText);
                        existInMap = true;
                        break;
                    }
                }

                // If the doctext for the comment doesn't already exist, then it is a multiline comment
                if (!existInMap) {
                    authorComment.docText.push(docText);
                    multilineComment = true;
                }
                // Otherwise, the comment already exist
                else {
                    break;
                }
            }
        }

        // If there is a new comment then we add it to the comment map and new comments
        if (!multilineComment && !existInMap) {
            currentMap[author].push(commentObj)
            commentThreadElementMap[totalCommentBlocks.toString()] = element;
            // totalCommentBlocks++;
        }
    }
    else {
        currentMap[author] = [commentObj]
        commentThreadElementMap[totalCommentBlocks.toString()] = element;
        // totalCommentBlocks++;
    }
}

/**
 * Fetch comment replies (replied comments to a thread)
 * @param {*} author 
 * @param {*} comment 
 * @param {*} time 
 * @param {*} root 
 */
function updateCommentReply(author, comment, time, root) {
    let commentObj = {
        author: author,
        comment: comment,
        time: time,
    }

    // Iterate through the commentMap to find the correct root comment to attach reply to
    if (root.author in currentMap) {
        existInMap = false;
        for (let i = 0; i < currentMap[author].length; i++) {
            let authorComment = currentMap[author][i];

            //console.log("Author Comment: ", authorComment, "Comment: ", comment, "Time: ", time);
            // If the comment and time are correct then we see if the reply has already been added before
            if (authorComment.comment === root.comment && authorComment.time === root.time) {
                for (let j = 0; j < authorComment.reply.length; j++) {
                    const reply = authorComment.reply[j];
                    if (reply.author === author && reply.time === time && reply.comment === comment) {
                        //console.log("Match: ", docText);
                        existInMap = true;
                        break;
                    }
                }

                // If the reply for the comment doesn't already exist, then this is an untracked reply
                if (!existInMap) {
                    commentObj["response"] = {time: authorComment.time, comment: authorComment.comment};
                    authorComment.reply.push(commentObj);
                }
                // Otherwise, the comment already exist
                else {
                    break;
                }
            }
        }
    }
}

/**
 * Helper function to add comments to the unread section (to be read for TTS system)
 * @param {*} updates 
 * @param {*} unread 
 */
function addToUnread(updates, unread) {
    updates.forEach(c => {
        unread.push(c);
    })
}

function formatTimeToDate(timeStr) {
    
}

/**
 * Compare the comments from the current version and the new version from this state
 * @returns 
 */
function compareCommentMap() {
    let commentChange = {"deleted": [], "threads": [], "replies": []};
    console.log("CommentMap: ", commentMap);
    // console.log("CurrentMap: ", currentMap);
    for (const [key, value] of Object.entries(currentMap)) {
        // console.log("Name: ", key, " Comments: ", value);
        if (key in commentMap) {
            for (var i = 0; i < value.length; i++) {
                let comment = value[i];
                let commentFound = false;
                for (var j = 0; j < commentMap[key].length; j++) {
                    let temp = commentMap[key][j];
                    if (temp.comment === comment.comment && temp.time === comment.time) {
                        commentFound = true;
                        comment.reply.forEach(r => {
                            let replyFound = false;
                            temp.reply.forEach(temp_r => {
                                if (r.author === temp_r.author && r.comment === temp_r.comment && r.time === temp_r.time) {
                                    replyFound = true;
                                }
                            })

                            if (!replyFound) {
                                temp.push(r);
                                commentChange["replies"].push(r);
                            }
                        });
                        break;
                    }
                }

                if (!commentFound) {
                    comment.id = totalCommentBlocks++;
                    commentMap[key].push(comment);
                    commentChange["threads"].push(comment);
                }
            }
        }
        else {
            // console.log("No comments; adding everything to commentMap");
            commentMap[key] = value;
            value.forEach((c, i) => {
                c.id = totalCommentBlocks++;
                commentChange["threads"].push(c);
            })
        }
    }

    for (const [key, value] of Object.entries(commentMap)) {
        // console.log("CommentMap: ", key, " value: ", value);
        if (key in currentMap) {
            for (var i = 0; i < value.length; i++) {
                let comment = value[i];
                let commentFound = false;
                for (var j = 0; j < currentMap[key].length; j++) {
                    let temp = currentMap[key][j];
                    if (temp.comment === comment.comment && temp.time === comment.time) {
                        commentFound = true;
                        comment.reply.forEach(r => {
                            let replyFound = false;
                            temp.reply.forEach(temp_r => {
                                if (r.author === temp_r.author && r.comment === temp_r.comment && r.time === temp_r.time) {
                                    replyFound = true;
                                }
                            })

                            if (!replyFound) {
                                commentChange["deleted"].push(r);
                            }
                        });
                        break;
                    }
                }

                if (!commentFound) {
                    commentChange["deleted"].push(comment);
                }
            }
        }
        else {
            value.forEach(c => {
                commentChange["deleted"].push(c);
            });
        }
    }

    // console.log("Comment Changes: ", commentChange);
    return commentChange;
}

//////////////////////////////////////////////////////////////////////////////////////////////
/// UTILITY FUNCTIONS: SOCKET IO
//////////////////////////////////////////////////////////////////////////////////////////////
// Helper function to make GET/POST Requests with the server with an oncomplete/onerror function
// See: https://stackoverflow.com/questions/30008114/how-do-i-promisify-native-xhr
function sendMessage(content, type, url, done) {
    console.log("Sending with Content: ", content);
    var xhr = new XMLHttpRequest();
    xhr.open(type, url, true);
    xhr.onload = function () {
        done(null, xhr.response);
    };
    xhr.onerror = function () {
        done(xhr.response);
    };
    xhr.setRequestHeader('Access-Control-Allow-Headers', '*');
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Access-Control-Allow-Origin', '*');

    // xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');

    xhr.send(JSON.stringify(content));
}

// If this variable is true, then the server will use the database to compare the contents or create a new record
var currentURL = "";
/**
 * Helper function called when we need to send the data to the server DB for async update (use hotkey button)
 */
function setAsyncState() {
    sendMessage({
        "comments": commentMap, 
        "url": currentURL, 
        "collaborators": collabState, 
        "history": textTimeMap,
    }, "POST", `${host_ipv4}/close_extension`, 
    function(err, resp) {
        if (err === null && socketReady) {
            $('#asyncannouncement').remove();
            $("<p id='asyncannouncement' role='alert' aria-live='assertive'>CollabAlly has been turned off. All changes have been saved remotely.</p>").appendTo(document.body);

            // Reset state of the entire extension
            socketReady = false;
            commentMap = {};
            newComments = {}
            newReplies = {}
            unreadComments = []
            unreadReplies = []
            collabState = {}
            textTimeMap = {}
            asyncTimeMap = {}
        }
    });
}

/**
 * Helper function to add the information about the collaborator and the text element that it corresponds to
 * @param {*} context 
 * @param {*} changes 
 */
function mergeContextWithChanges(context, changes) {
    Object.keys(context).forEach(collabName => {
        changes["new"].forEach(change => {
            if (change["collaborator"] === collabName) {
                change["text_location"] = context[collabName]
            }
        })

        changes["moved"].forEach(change => {
            if (change["collaborator"] === collabName) {
                change["text_location"] = context[collabName]
            }
        })

        changes["left"].forEach(change => {
            if (change["collaborator"] === collabName) {
                change["text_location"] = context[collabName]
            }
        })
    })
}

/**
 * Helper function called every N seconds to update the internal state of comments and collaborators
 * @param {*} sonify 
 */
function updateDocumentState(sonify = true) {
    var collaborator_levels = getCollabStates(currentURL);
    collabChangeSummary = compareMaps(collabState, collaborator_levels);

    getCollabComments(currentURL);
    commentChanges = compareCommentMap();
    commentMap = currentMap;
    mergeContextWithChanges(getContext(collaborator_levels), collabChangeSummary);

    collabChangeSummary["comments"] = commentChanges;
    collabChangeSummary["all"] = collaborator_levels;
    collabState = collaborator_levels;

    console.log("State changes: ", collabChangeSummary, " Sonify: ", sonify);
    if (sonify) 
        sonifyCollabState(collabChangeSummary);

    // Deep copies the new comments and replies to unread
    addToUnread(commentChanges["threads"], unreadComments)
    addToUnread(commentChanges["replies"], unreadReplies);

    // Reset state
    newComments = {};
    newReplies = {};
    currentMap = {};
}

// Listen to background script keyboard shortcut
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    currentURL = req.url;
    // Called at start to connect to socket
    if (req.message === "connectSocket" && !socketReady) {
        initializeModal();
        initKeycodes();
        initializeConnection();
        compare = setInterval(initializeComparison, delay);
    }

    else if (req.message === "connectSocket" && socketReady) {
        console.log("Extension is turning off...resetting state");
        setAsyncState();
    }

    // Called when we need to fetch collaborator states every N seconds
    else if (req.message === "getCollaborators" && socketReady) {
        updateDocumentState(true);
        return true;
    }

    // Called when we need to display the modal information on top of the document
    else if (req.message === "displayModal" && $('#myModal').css('display') === 'none' && socketReady) {
        if ($('#settingsModal').css('display') !== 'none')
            return;

        console.log("VoiceFonts: ", voiceFontMap);
        const tempTop = $(".kix-appview-editor").scrollTop();
        quickScroll(0, 0, () => {
            updateDocumentState(false);
            textTTS();
            commentTTS();
            collabTTS();
            OpenDialog();
            $(".kix-appview-editor").scrollTop(tempTop);
        })

        return true;
    }
    else if (req.message === "showSettings" && $('#settingsModal').css('display') === 'none' && socketReady) {
        if ($('#myModal').css('display') !== 'none')
            return;

        console.log("Showing Settings");
        showSettings();
    }
});

//////////////////////////////////////////////////////////////////////////////////////////////
/// RESONANCE AUDIO SDK SETUP
//////////////////////////////////////////////////////////////////////////////////////////////
let audioContext;
let scene;

// Dimensions of the virtual spatial audio room
let dimensions = {
  small: {
    width: 1.5, height: 2.4, depth: 1.3,
  },
  medium: {
    width: 4, height: 3.2, depth: 3.9,
  },
  large: {
    width: 8, height: 3.4, depth: 9,
  },
  huge: {
    width: 5, height: 5, depth: 2,
  },
};

// Material of the spatial audio room
let materials = {
  brick: {
    left: 'brick-bare', right: 'brick-bare',
    up: 'brick-bare', down: 'wood-panel',
    front: 'brick-bare', back: 'brick-bare',
  },
  curtains: {
    left: 'curtain-heavy', right: 'curtain-heavy',
    up: 'wood-panel', down: 'wood-panel',
    front: 'curtain-heavy', back: 'curtain-heavy',
  },
  marble: {
    left: 'marble', right: 'marble',
    up: 'marble', down: 'marble',
    front: 'marble', back: 'marble',
  },
  outside: {
    left: 'transparent', right: 'transparent',
    up: 'transparent', down: 'grass',
    front: 'transparent', back: 'transparent',
  },
};

let dimensionSelection = 'small';
let materialSelection = 'outside';
let audioReady = false;

// For implicit audio feedback
let audioSources = {
    "user_new": "implicit_audio/collab_enter_1.mp3",
    "user_move_enter": "implicit_audio/overlap_1.mp3",
    "user_move_leave": "implicit_audio/unoverlap_1.mp3",
    "user_quit": "implicit_audio/collab_quit_1.mp3",
    "user_comment": "implicit_audio/comment_add.mp3",
    "user_remove_comment": "implicit_audio/comment_delete.mp3",
};

let audioElements = {};
let soundSources = [];

// For Implicit Audio Feedback
let notificationAudioElement;
let notificationSoundSource;
let notifIndex = 1;

// For Explicit Audio Feedback
let summaryAudioElement;
let summarySoundSource;
let rootSummaryElement; // This is the actual element in the document that we care about
let summaryAudioTTSStr = "";

// File paths for different types of audio files
let textAudioPaths = [];

let implicitAudioPaths = [];

// Internal member variable that stores the current set of audio files and index of the comment we are reading
let _audioPaths;
let _audioIndex = 0;

const audioDelay = 500;

HTMLAudioElement.prototype.stop = function()
{
	this.pause();
	this.currentTime = 0.0;
}
  
/**
 * Called to initialize the audio elements for ear-con and TTS audio
 */
function initAudio() {
    console.log("Initializing Audio");
    audioContext = new (window.AudioContext || window.webkitAudioContext);
    // Initialize scene and create Source(s).
    scene = new ResonanceAudio(audioContext, {
        ambisonicOrder: 1,
    });
    scene.setRoomProperties(dimensions[dimensionSelection],
    materials[materialSelection]);

    // Create notification audio element
    notificationAudioElement = createAudioElement(`${host_ipv4}/get_audio?name=${audioSources["user_new"]}`);
    let notificationAudioSource = audioContext.createMediaElementSource(notificationAudioElement);
    notificationSoundSource = scene.createSource();
    notificationAudioSource.connect(notificationSoundSource.input);

    // Create summary audio element
    summaryAudioElement = createAudioElement(`${host_ipv4}/get_audio?name=${audioSources["user_new"]}`)
    let summaryAudioSource = audioContext.createMediaElementSource(summaryAudioElement);
    summarySoundSource = scene.createSource();
    summaryAudioSource.connect(summarySoundSource.input);

    scene.output.connect(audioContext.destination);
    audioReady = true;
}

/**
 * Helper function to create the audio element 
 * @param {*} src 
 * @returns 
 */
function createAudioElement(src) {
    let audioElement = document.createElement('audio');
    audioElement.src = src;
    // audioElement.mozPreservesPitch = false;
    // audioElement.playbackRate = 0.5;
    audioElement.crossOrigin = 'anonymous';
    audioElement.loop = false; // true;
    return audioElement;
}

/**
 * Function to update implicit audio feedback based on collaborator state changes + comment changes
 * @param {Object} collabChanges The object summarizing changes in collaborator state and new comments
 */

// 2 Possible implementations:
// 1) Sonification based on type of change (e.g. )
// 2) Sonification based on user (e.g. )
const leaveDist = 0.1;
function sonifyCollabState(collabChanges) {
    notificationAudioElement.stop();
    implicitAudioPaths.splice(0, implicitAudioPaths.length); // Clear the audio paths first

    console.log("New collaborators: ", collabChanges["new"]);
    // If there is at least one new user, play the new user audio
    for (var i = 0; i < collabChanges["new"].length; i++) {
        const collab = collabChanges["new"][i];
        if (collab["collaborator"] !== "Self") {
            implicitAudioPaths.push({pos: collabChanges["new"][0]["location"]["pos"], audio: "user_new"});
            break;
        }
    }

    console.log("Moved collaborators: ", collabChanges["moved"]);
    // If there is at least one person who is close to the user, then we play moved audio
    // TODO: Queue multiple FX if users keep moving?
    for (var i = 0; i < collabChanges["moved"].length; i++) {
        const collabAudio = collabChanges["moved"][i];
        if (collabAudio["collaborator"] !== "Self") {
            // Determine whether user is farther or closer to current user (leave vs enter area)
            let fromPosY = collabAudio["from"]["pos"].y - selfCursorPos.y;
            let toPosY = collabAudio["location"]["pos"].y - selfCursorPos.y;

            // If we are outside the leave threshold then we will play leave notification
            if (Math.abs(toPosY) > leaveDist && Math.abs(fromPosY) < leaveDist) {
                implicitAudioPaths.push({pos: collabAudio["location"]["pos"], audio: "user_move_leave"});
            }
            // Otherwise if we are inside the leave threshold then we will play the enter notification
            else if (Math.abs(toPosY) < leaveDist && Math.abs(fromPosY) > leaveDist) {
                implicitAudioPaths.push({pos: collabAudio["location"]["pos"], audio: "user_move_enter"});
            }
        }
    }

    console.log("Left collaborators: ", collabChanges["left"]);
    for (var i = 0; i < collabChanges["left"].length; i++) {
        const collab = collabChanges["left"][i];
        if (collab["collaborator"] !== "Self") {
            // stopAllImplicit();
            // audioElements["user_new"].play();
            implicitAudioPaths.push({pos: collabChanges["left"][0]["location"]["pos"], audio: "user_quit"});
            break;
        }
    }

    console.log("Idle collaborators: ", collabChanges["idle"]);
    // We treat left and idle as the same
    for (var i = 0; i < collabChanges["idle"].length; i++) {
        const collab = collabChanges["idle"][i];
        if (collab["collaborator"] !== "Self") {
            implicitAudioPaths.push({pos: collabChanges["idle"][0]["location"]["pos"], audio: "user_quit"});
            break;
        }
    }

    console.log("New comment: ", collabChanges["comments"]);
    if (Object.keys(collabChanges["comments"]["threads"]).length > 0  || 
        Object.keys(collabChanges["comments"]["replies"]).length > 0) {
            // implicitAudioPaths.push({pos: {x: 1, y: selfCursorPos.y}, audio: "user_comment"});
            let comment = collabChanges["comments"]["threads"][0];
            if ((collabChanges["comments"]["threads"]).length === 0) {
                comment = collabChangeSummary["comments"]["replies"][0];
            }

            console.log("Comment to be played with earcon: ", comment);

            implicitAudioPaths.push({pos: {x: 1, y: comment.scroll.y}, audio: "user_comment"});
    }
    else if (Object.keys(collabChanges["comments"]["deleted"]).length > 0) {
            // implicitAudioPaths.push({pos: {x: 1, y: selfCursorPos.y}, audio: "user_remove_comment"});
            let comment = collabChanges["comments"]["deleted"][0]
            implicitAudioPaths.push({pos: {x: 1, y: comment.scroll.y}, audio: "user_remove_comment"});
    }

    playImplicitAudio();
}

/**
 * Helper function to move the audio element relative to the current viewport
 * @param {ResonanceAudioSoundSource} soundElement The spatial audio element object for Resonance Audio
 */
// TODO: Modify direction based on settings
function setAudioViewportPosition(soundElement) {
    let docViewport = document.getElementsByClassName("kix-appview-editor")[0];

    let normalizedX = ($(rootSummaryElement).offset().left - docViewport.clientWidth/2)/docViewport.clientWidth;
    let normalizedY = ($(rootSummaryElement).offset().top - docViewport.clientHeight/2)/docViewport.clientHeight;
    normalizedX = Math.min(1, Math.max(-1, normalizedX));
    normalizedY = Math.min(1, Math.max(-1, normalizedY));

    let gain = Math.min(Math.max(1 - Math.abs(normalizedY), 0.25), 1);

    // Edge case: the comment is outside of viewport so location becomes (0, 0)
    // Reduce the gain so that users are aware that they are not near the actual element yet
    if ($(rootSummaryElement).offset().left === 0 && $(rootSummaryElement).offset().top === 0) {
        normalizedX = 0;
        normalizedY = 0;
        gain = 0.15;
    }

    let x = normalizedX * dimensions[dimensionSelection].width;
    let y = normalizedY * dimensions[dimensionSelection].height;
    let z = dimensions[dimensionSelection].depth / 4; // By default, just in front of you

    // Vary volume based on ratio of distance
    soundElement.setPosition(x, y, z);

    // console.log("Moved: ", soundElement, " to: ", soundElement._position);
}

/**
 * Helper function to move the collaborator notification audio relative to the cursor
 * @param {*} collabPos 
 * @param {*} soundElement 
 */
function setCollabAudioPosition(collabPos, soundElement) {
    console.log("Position to move spatial audio: ", collabPos, "With cursor position: ", selfCursorPos, " and settings: ", settings_config);
    const docViewport = document.getElementsByClassName("kix-page-paginated")[0]

    let x = settings_config.direction === "RL" ? (selfCursorPos.y - collabPos.y) : 0;
    x = settings_config.direction === "LR" ? (collabPos.y - selfCursorPos.y) : x;
    let y = settings_config.direction === "TB" ? (selfCursorPos.y - collabPos.y) : 0;
    y = settings_config.direction === "BT" ? (collabPos.y - selfCursorPos.y) : y;
    let z = settings_config.direction === "FB" ? (selfCursorPos.y - collabPos.y) : dimensions[dimensionSelection].depth / 4; // By default, just in front of you
    z = settings_config.direction === "BF" ? (collabPos.y - selfCursorPos.y) : z;

    let normalizedX = Math.min(1, Math.max(-1, x)) * dimensions[dimensionSelection].width,
    normalizedY = Math.min(1, Math.max(-1, y)) * dimensions[dimensionSelection].height,
    normalizedZ = Math.min(1, Math.max(-1, z)) * dimensions[dimensionSelection].depth;

    soundElement.setPosition(normalizedX, normalizedY, normalizedZ);
    console.log("Moved: ", soundElement, " to: ", soundElement._position);
}

/**
 * Play the implicit audio at a specified location in the document
 */
function playImplicitAudio() {
    if (implicitAudioPaths.length > 0) {
        let srcPath = audioSources[implicitAudioPaths[0].audio];
        console.log("Playing: ", srcPath);
        notificationAudioElement.src = `${host_ipv4}/get_audio?name=${srcPath}`;
        notifIndex = 1;
        notificationAudioElement.onended = function() {
            if (notifIndex < implicitAudioPaths.length) {
                let srcPath = audioSources[implicitAudioPaths[notifIndex].audio];
                console.log("Playing: ", srcPath);
                notificationAudioElement.src = `${host_ipv4}/get_audio?name=${srcPath}`;
                setCollabAudioPosition(implicitAudioPaths[notifIndex].pos, notificationSoundSource);
                notificationAudioElement.play();
                notifIndex++;
            }
        };
        setCollabAudioPosition(implicitAudioPaths[0].pos, notificationSoundSource);
        notificationAudioElement.play();
    }
}

/**
 * Helper function to stop the audio and temporarily wait until next audio is supposed to play
 */
function interruptAudio() {
    console.log("Summary Element: ", summaryAudioElement);
    if (TTSPlaying && summaryAudioElement !== undefined) {
        console.log("Stopped Playing Summary Audio");
        summaryAudioElement.stop();
        TTSPlaying = false;
    }
}

/**
 * Function to fetch the updated TTS mp3 audio file from server to read out the TTS from corresponding button
 * @param {*} tts 
 * @param {*} srcPath 
 * @param {*} position 
 */
function playDialogTTS(tts, srcPath, position) {
    console.log("POSITION: ", position);
    if (!TTSPlaying && summaryAudioElement !== undefined) {
        if (tts === summaryAudioTTSStr) {
            setCollabAudioPosition(position, summarySoundSource);
        }
        else {
            summaryAudioElement.stop();
            summaryAudioElement.src = `${host_ipv4}/get_audio?name=${srcPath}`;
            setCollabAudioPosition(position, summarySoundSource);
            summaryAudioElement.play();
        }
    }
}

//////////////////////////////////////////////////////////////////////////////////////////////
/// DIALOG BOX HELPER FUNCTIONS
//////////////////////////////////////////////////////////////////////////////////////////////
/**
 * Helper function to initialize the modal when it opens
 */
function loadingModal() {
    $('#modal-content').css('display', "none");
    $('#modal-status').css('display', "block");
    $('#myModal').css('display', "block");

    $("#tab_Collaborators").on('click', function() {
        openChange('Collaborators');
    });

    $("#tab_Comments").on('click', function() {
        console.log("Opening Comments");
        openChange('Comments');
    })

    $("#tab_Text").on('click', function() {
        openChange('Text');
    })

    $('#myModal').css('display', "block");
    OpenDialog();
}

/**
 * Helper function to update the content of the modal based on states and server information 
 * @param {*} changeClass 
 * @param {*} textSummary 
 * @param {*} summary 
 */
function updateModal(changeClass, textSummary, summary = null) {
    // console.log("Context Elements: ", contextElements);
    $('#modal-status').css('display', "none");

    let htmlStr = "";
    for (let i = 0; i < textSummary.length; i++) {
        htmlStr += `<div>${textSummary[i]}</div>`
    }

    if (summary !== null)
        htmlStr = `<div>${summary}</div>` + htmlStr;

    $(`#${changeClass}`).html(htmlStr);
    $(`.navigate_button`).off('click').click(function() {
        console.log("Clicked: ", $(this).data('name'), ' Scroll: ', $(this).data('scroll'));
        const scrollAmount = $(this).data('scroll');
        const divElement = $(this).data('name');
        const docViewport = document.getElementsByClassName("kix-appview-editor")[0];
        $(".kix-appview-editor").scrollTop(scrollAmount - docViewport.clientHeight/2); 
        if (divElement !== "" && divElement !== null && divElement !== undefined) {
            copyToClipboard($('#'+divElement)[0]);
        }
        else {
            const textString = $(this).data('text');
            copyTextToClipboard(textString);
        }

        $('#copyannouncement').remove();
        $("<p id='copyannouncement' role='alert' aria-live='assertive'>The text has been copied to your clipboard.</p>").appendTo(document.body);
    });

    // This will only be used for text, collab, and comment changes (not summaries)
    $(`.tts_button`).off('click').click(function() {
        console.log("DATA: ", $(this).data());
        let data = {x: $(this).data().x, y: $(this).data().y};

        console.log("DATA: ", data);

        const tts_str = $(this).text();
        const tts_lang = $(this).attr('lang');
        const tts_voice = $(this).data().gender === undefined ? tts_lang_map["en-" + settings_config.accent][settings_config.gender] : $(this).data().gender;

        // TODO: Configure based on settings
        sendMessage({"tts_str": tts_str, "tts_lang": tts_lang, "speed": settings_config.speed, "tts_voice": tts_voice}, "POST", `${host_ipv4}/dialog_to_speech`, function(err, resp) {
            if (err === null && audioReady) {
                interruptAudio();

                let mediaResp = JSON.parse(resp);
                console.log("Text to Speech Response: ", mediaResp, " from ", resp);

                playDialogTTS(tts_str, mediaResp[0], data);
            }
        });
    
    })

    $('#modal-content').css('display', "block");
    $(`#${changeClass}`).css('display', "block");
}

/**
 * Update the status text of the modal status (i.e. "Loading inforamation" is visible or not)
 * @param {*} textSummary 
 */
function updateModalStatus(textSummary) {
    $('#modal-status').css('display', "block");
    $('#modal-status').text('');
    textSummary.forEach(text => {
        $('#modal-status').append(text);
    })
}

/**
 * Function to actually view the changes in the modal dialog box (i.e. make it visible)
 * @param {*} changeName 
 */
function openChange(changeName) {
    var i;
    var x = document.getElementsByClassName("changes");
    for (i = 0; i < x.length; i++) {
        x[i].style.display = "none";
    }

    var tabs = document.getElementsByClassName("tab_button");
    for(let j = 0; j < tabs.length; j++) {
        tabs[j].setAttribute("aria-pressed", "false");
    }

    document.getElementById(changeName).style.display = "block";
    document.getElementById(`tab_${changeName}`).setAttribute("aria-pressed", "true");
}
  
let focusElement;
/**
 * Actual function to open and show the dialog box (i.e. make it visible) and update focused element
 */
function OpenDialog() {
    console.log("Opening Dialog");
    $('#modal-status').text('Loading information');
    focusElement = document.activeElement;

    //   DialogTrigger = btnID;
      // Get all the elements to manipulate
      var body = document.getElementsByTagName("body");
      var landmarks = document.querySelectorAll("header, main, footer");
      var overlay = document.getElementById("myModal");  
      var dialog = document.getElementById("main_modal");  
      var focusElm = document.getElementById("modal-body");
      // Hide the content regions from AT
      for (var i = 0; i < landmarks.length; i++) {
        landmarks[i].setAttribute("aria-hidden","true");
        landmarks[i].setAttribute("inert","");
      }
      // Hide the content behind the overlay
      overlay.style.display = "block";
      // Add click handler to overlay
      // Kill the page scroll
      body[0].style.overflow = "hidden";
      // Set the dialog to modal
      dialog.setAttribute("aria-modal","true");
      dialog.removeAttribute("hidden"); 
      // Put focus on the close button
      // Normally I would put it on the modal, but this fits
      $(".modal_close").on('click', function() {
          CloseDialog();
      });

      // Close comment and text change div- show collab by default
    openChange("Collaborators");
    dialog.focus();
}
  
/**
 * Helper function to close the dialog box and then set focus to navigated element
 */
function CloseDialog() {
    try {
        console.log("Closing Dialog");

        // Get all the elements to manipulate
        var body = document.getElementsByTagName("body");
        var landmarks = document.querySelectorAll("header, main, footer");
        var overlay = document.getElementById("myModal");
        var dialog = document.getElementById("main_modal");
        // Make the regions available to AT
        for (var i = 0; i < landmarks.length; i++) {
            landmarks[i].removeAttribute("aria-hidden");
            landmarks[i].removeAttribute("inert");
        }
        // Remove the overlay
        overlay.style.display = "none";
        // Return the scrollbar
        body[0].style.overflow = "auto";
        // Kill the dialog
        dialog.removeAttribute("aria-modal");
        dialog.removeAttribute("data-id");
        dialog.setAttribute("hidden","");

        // Return focus to trigger
        console.log('FocusElement: ', focusElement);

        focusElement.focus();

    } catch (e) {
      console.log("CloseDialog Error: " + e);
    }
}

// Originally from https://stackoverflow.com/questions/22581345/click-button-copy-to-clipboard-using-jquery
function copyToClipboard(elem) {
    // create hidden text element, if it doesn't already exist
    var targetId = "_hiddenCopyText_";
    var isInput = elem.tagName === "INPUT" || elem.tagName === "TEXTAREA";
    elem.textContent = elem.textContent.trim().replace(/[^\x00-\x7F]/g, "").replace(/[\u{0080}-\u{FFFF}]/gu,"");
    var origSelectionStart, origSelectionEnd;
    if (isInput) {
        // can just use the original source element for the selection and copy
        target = elem;
        origSelectionStart = elem.selectionStart;
        origSelectionEnd = elem.selectionEnd;
    } else {
        // must use a temporary form element for the selection and copy
        target = document.getElementById(targetId);
        if (!target) {
            var target = document.createElement("textarea");
            target.style.position = "absolute";
            target.style.left = "-9999px";
            target.style.top = "0";
            target.id = targetId;
            document.body.appendChild(target);
        }
        target.textContent = elem.textContent;
    }
    // select the content
    var currentFocus = document.activeElement;
    target.focus();
    target.setSelectionRange(0, target.value.length);
    
    // copy the selection
    var succeed;
    try {
        succeed = document.execCommand("copy");
    } catch(e) {
        succeed = false;
    }

    // restore original focus
    if (currentFocus && typeof currentFocus.focus === "function") {
        currentFocus.focus();
    }
    
    if (isInput) {
        // restore prior selection
        elem.setSelectionRange(origSelectionStart, origSelectionEnd);
    } else {
        // clear temporary content
        target.textContent = "";
    }
    return succeed;
}

function copyTextToClipboard(text) {
    var targetId = "_hiddenCopyText_";
    var target = document.createElement("textarea");
    target.style.position = "absolute";
    target.style.left = "-9999px";
    target.style.top = "0";
    target.id = targetId;
    document.body.appendChild(target);
    target.textContent = text.trim().replace(/[^\x00-\x7F]/g, "").replace(/[\u{0080}-\u{FFFF}]/gu,"");

    // select the content
    var currentFocus = document.activeElement;
    target.focus();
    target.setSelectionRange(0, target.value.length);
    
    // copy the selection
    var succeed;
    try {
        succeed = document.execCommand("copy");
    } catch(e) {
        succeed = false;
    }

    // restore original focus
    if (currentFocus && typeof currentFocus.focus === "function") {
        currentFocus.focus();
    }

    target.textContent = "";
    return succeed;
}

//////////////////////////////////////////////////////////////////////////////////////////////
/// LOCAL TTS GENERATOR 
//////////////////////////////////////////////////////////////////////////////////////////////
function commentTTS() {
    const h2Start = `<h2 lang='en-${settings_config.accent}'>`
    const pStart = `<p lang='en-${settings_config.accent}'>`

    let commentStr = []
    let commentCount = 1;
    let commentPageMap = {}
    
    for (const [author, comments] of Object.entries(commentMap)) {
        comments.forEach((comment, j) => {
            console.log("Author: ", author, " with comment: ", comment);
            if (!("tts" in comment)) {
                let region = settings_config.accent;
                if (voiceFontMap[author] !== undefined)
                    region = voiceFontMap[author].region;

                let str = `<h1 lang='en-${region}'>Comment thread ${commentCount}</h1>${parseComment(author, comment, commentCount)}
                <button data-name='comment_${commentCount}' data-scroll='${comment.scroll.y}'class='navigate_button' role='button'>Copy Selected Text to Clipboard</button>`;
                commentStr.push(str);
                comment.tts = str;
            }
            else {
                commentStr.push(str);
            }

            if (comment.page.number in commentPageMap)
                commentPageMap[comment.page.number]++;
            else
                commentPageMap[comment.page.number] = 1;

            $(comment.html).attr('id', `comment_${commentCount}`);
            console.log("Comment: ", comment.html);
            commentCount++;
        })
    }

    commentCount--;

    let comment_summary_tts = `<h1 lang='en-${settings_config.accent}'>Comment Summary</h1>`

    // CONCISE MODE
    if (settings_config.mode === "Concise") {
        comment_summary_tts += `${h2Start}Total Comment Threads:</h2>${pStart}${commentCount}</p>`
        for (const [page, comments] of Object.entries(commentPageMap)) {
            comment_summary_tts += `${h2Start}Page ${page}:</h2>${pStart}${comments} comment${comments === 1 ? "" : "s"}</p>`
        }
    }
    // NARRATIVE MODE
    else {
        comment_summary_tts += `There ${commentCount === 1 ? "is" : "are"} currently ${commentCount} comment${commentCount === 1 ? '' : 's'} in the document. `
        for (const [page, comments] of Object.entries(commentPageMap)) {
            comment_summary_tts += `${comments} comment${comments === 1 ? "" : "s"} ${comments === 1 ? "is" : "are"} on page ${page}. `
        }
    }

    updateModal("Comments", commentStr, comment_summary_tts);

    unreadComments.splice(0, unreadComments.length);
    unreadReplies.splice(0, unreadReplies.length);
}

// ORDER: AUTHOR, COMMENT, SELECTED TEXT, TIME
function parseComment(author, comment, index) {
    let audioStr = "";
    let context = "";
    console.log("Author Comment: ", author, "for comment: ", comment);
    let VFStr = settings_config.accent;
    let VFGender = tts_lang_map['en-' + settings_config.accent][settings_config.gender];
    if (voiceFontMap[author] !== undefined) {
        VFGender = voiceFontMap[author].voice;
        VFStr = voiceFontMap[author].region;
    }

    const buttonStart = `<button class='tts_button' lang='en-${VFStr}' data-gender='${VFGender}' data-x='${comment.scroll.x}' data-y='${comment.scroll.y}'>`
    const h3Start = `<h3 lang='en-${VFStr}'>`
    const h2Start = `<h2 lang='en-${VFStr}'>`
    // console.log(buttonStart);

    context = `${h3Start}Selected text:</h3>`;
    if (comment['docText'].length < 2)  {
        context += `${buttonStart}${comment['docText'][0]}</button>`;
    }
    else {
        context += `${buttonStart}Beginning on the line, ${comment['docText'][0]}, and ending on the line, ${comment['docText'][comment['docText'].length - 1]}</button><br>`
    }

    audioStr += `${h3Start}Author:</h3>${buttonStart}${author}</button><br>`
    audioStr += `${h3Start}Comment:</h3>${buttonStart}${comment['comment']}</button><br>`
    audioStr += context
    audioStr += `${h3Start}Time:</h3><div lang='en-${VFStr}'>${comment['time']}</div>`
    audioStr += `${h3Start}Location:</h3><div lang='en-${VFStr}'>${comment['page']['location']} of page ${comment['page']['number']}</div>`

    comment['reply'].forEach((reply, i) => {
        var VFReplyStr = settings_config.accent;
        if (voiceFontMap[reply['author']] !== undefined)
            VFReplyStr = voiceFontMap[reply['author']].region;

        let VFReplyGender = settings_config.gender;
        if (voiceFontMap[reply['author']] !== undefined)
            VFReplyGender = voiceFontMap[reply['author']].voice;
        var replyButtonStart = `<button class='tts_button' lang='en-${VFReplyStr}' data-gender='${VFReplyGender}' data-x='${comment.scroll.x}' data-y='${comment.scroll.y}'>`

        let replyStr = `${h3Start}Author:</h3>${replyButtonStart}${reply['author']}</button><br>`
        replyStr += `${h3Start}Reply:</h3>${replyButtonStart}${reply['comment']}</button><br>`
        replyStr += `${h3Start}Time:</h3><div lang='en-${VFReplyStr}'>${reply['time']}</div><br>`;

        audioStr += `${h2Start}Comment Thread ${index} Reply ${i}</h2>${replyStr}`
    })

    return audioStr
}

// Aria label to give additional information if this has been copied or not- aria-live or aria-assertive
// Add instructions to tell them during the protocol to escape and then navigate afterwards
function collabTTS() {
    collab_strings = []
    collabCount = 1
    const VFStr = settings_config.accent;
    const h2Start = `<h2 lang='en-${VFStr}'>`
    const pStart = `<p lang='en-${VFStr}'>`
    const docHeight = document.getElementsByClassName("kix-page-paginated")[0];
    console.log("Collab Changes: ", collabChangeSummary["all"]);
    for (const [name, state] of Object.entries(collabChangeSummary["all"])) {
        console.log("Name: ", name);
        console.log("State: ", state);
        if (name === "Self")
            continue;

        const VFStr = voiceFontMap[name] === undefined ? settings_config.accent : voiceFontMap[name].region;
        const VRStrVoice = voiceFontMap[name] === undefined ? settings_config.gender : voiceFontMap[name].voice;
        const buttonStart = `<button class='tts_button' lang='en-${VFStr}' data-gender='${VRStrVoice}' data-x='${$(state["element"]).offset().left}' data-y='${($(state["element"]).offset().top - docHeight.offsetTop)/docHeight.clientHeight}' role='button'>`
        const h2Start = `<h2 lang='en-${VFStr}'>`
        const h1Start = `<h1 lang='en-${VFStr}'>`

        let collab_tts = `${h1Start}Collaborator ${collabCount}</h1>`
        collab_tts += `${h2Start}Name:</h2>${buttonStart}${name}</button><br>`
        collab_tts += `${h2Start}Selected Text:</h2>${buttonStart}${state["text"]}</button><br>`
        collab_tts += `<button data-name='collab_${collabCount}' data-scroll='${$(state["element"]).offset().top}'class='navigate_button' role='button'>Copy Selected Text to Clipboard</button>`
        collab_tts += `${h2Start}Location:</h2>${buttonStart}${state["context"]} of page ${state["page"]}</button><br>`

        collab_strings.push(collab_tts)
        $(collabState[name].element).attr('id', `collab_${collabCount}`);
        collabCount++;
    }

    collabCount--;
    let newStr = collabChangeSummary["new"] === 0 ? "" : `${collabChangeSummary['new'].length} collaborator${collabChangeSummary['new'].length === 1 ? "" : "s"} joined,`

    let movedStr = collabChangeSummary["moved"] === 0 ? "" : ` ${collabChangeSummary['moved'].length} collaborator${collabChangeSummary['moved'].length === 1 ? "" : "s"} moved,`

    let leftStr = collabChangeSummary["left"] === 0 ? "" : ` ${collabChangeSummary['left'].length} collaborator${collabChangeSummary['left'].length === 1 ? "" : "s"} left,`

    let idle_num = collabChangeSummary["idle"].length + collabChangeSummary["inactive"].length
    let idleStr = collabChangeSummary["left"] === 0 ? "" : ` and ${idle_num} collaborator${idle_num === 1 ? "" : "s"} ${idle_num === 1 ? "is" : "are"} idle,`

    let collabNumStr = `${collabCount === 1 ? "is" : "are"} currently ${collabCount} collaborator${collabCount === 1 ?'':"s"}`
    let collab_summary_tts = `<h1 lang='en-${settings_config.accent}'>Collaborator Summary</h1>`

    // CONCISE MODE
    if (settings_config.mode === "Concise") {
        collab_summary_tts += `${h2Start}Total Collaborators:</h2>${pStart}${collabCount}</p>`
        collab_summary_tts += `${h2Start}New Collaborators:</h2>${pStart}${collabChangeSummary['new'].length}</p>`
        collab_summary_tts += `${h2Start}Idle Collaborators:</h2>${pStart}${collabChangeSummary['idle'].length}</p>`
        collab_summary_tts += `${h2Start}Collaborators that Moved:</h2>${pStart}${collabChangeSummary['moved'].length}</p>`
        collab_summary_tts += `${h2Start}Collaborators that Left:</h2>${pStart}${collabChangeSummary['left'].length}</p>`
    }

    // NARRATIVE MODE
    else {
        collab_summary_tts += `There ${collabNumStr} in the document. ${newStr}${movedStr}${leftStr}${idleStr}`
    }

    updateModal("Collaborators", collab_strings, collab_summary_tts);
}

let textTimeMap = {}
let asyncTimeMap = {}
// Keep summary concise- Make it as a navigatable structure (current version is too lengthy- 2 changes + page number)
function textTTS() {
    sendMessage({"collaborators": collabState, "page_info": docHTMLContextJSON, "comments": commentMap}, "POST", `${host_ipv4}/text_to_speech`, function(err, resp) {
        if (err === null && audioReady) {
            const h1Start = `<h1 lang='en-${settings_config.accent}'>`
            const h2Start = `<h2 lang='en-${settings_config.accent}'>`
            const pStart = `<p lang='en-${settings_config.accent}'>`
            TTSPlaying = false;

            let mediaResp = JSON.parse(resp);
            const now = Date.now();

            text_dialog_changes = parseText(mediaResp);
            console.log("Text to Speech Response: ", mediaResp, " from ", resp);
            console.log("HTML Document Map: ", docHTMLElementMap);

            Object.keys(textTimeMap).sort((a, b) => a - b).forEach(date => {
                const text_change = textTimeMap[date];

                changes = parseText(text_change);
                if (changes.length > 0) {
                    const diffTime = Math.abs(now - date);
                    const diffSec = Math.round(diffTime/1000);
                    const diffMin = Math.round(diffSec/60);
                    const diffHr = Math.round(diffMin/60);

                    if (diffHr >= 1) {
                        changes[0] = `${h1Start}${diffHr} hours ago</h1>` + changes[0];
                    }
                    else if (diffMin >= 1) {
                        changes[0] = `${h1Start}${diffMin} minutes ago</h1>` + changes[0];
                    }
                    else if (diffSec >= 1) {
                        changes[0] = `${h1Start}${diffSec} seconds ago</h1>` + changes[0];
                    }
                }

                text_dialog_changes = text_dialog_changes.concat(changes);
            })
            
            if (text_dialog_changes.length > 0)
                text_dialog_changes[0] = `${h1Start}New Changes</h1>` + text_dialog_changes[0];
            // console.log(text_dialog_changes);
            textTimeMap[now] = mediaResp;
            text_summary_tts = `${h1Start}Text Summary</h1>`

            // CONCISE MODE
            if (settings_config.mode === 'Concise') {
                text_summary_tts += `${h2Start}Total Text Changes:</h2>${pStart}${mediaResp["summary"]["text"]}</p>`
                text_summary_tts += `${h2Start}Total Style Changes:</h2>${pStart}${mediaResp["summary"]["style"]}</p>`
                for (const [page, count] of Object.entries(mediaResp["summary"]["page"])) {
                    text_summary_tts += `${h2Start}Page ${page}:</h2>${pStart}${count} change${count === 1 ? "" : "s"}</p>`
                }
            }
            // NARRATIVE MODE
            else {
                let page_detail = ""
                for (const [page, count] in Object.entries(mediaResp["summary"]["page"])) {
                    let change_str = count > 1 ? "changes are" : "change is"
                    page_detail += `${count} ${change_str} in page ${page}. `
                }
                text_summary_tts += `Since you last queried this tool, there have been ${mediaResp["summary"]["style"]} style change${mediaResp["summary"]["style"] === 1 ? "" : "s"} and ${mediaResp["summary"]["text"]} text change${mediaResp["summary"]["text"] === 1 ? "" : "s"} in the document. ${page_detail}`;
            }

            updateModal("Text", text_dialog_changes, text_summary_tts);
            openChange("Collaborators")
        }
    });
}

// TODO: Have an async history map
function parseText(textObj) {
    text_strings = []

    // Generate the detailed summaries
    textObj["details"].forEach((change, i) => {
        const VFStr = settings_config.accent;
        const text_element = docHTMLElementMap[change["coordinates"][0]].text[change["coordinates"][1]].element;
        const buttonStart = `<button class='tts_button' lang='en-${VFStr}' data-gender='${settings_config.accent}' data-x='${text_element.offsetLeft}' data-y='${text_element.offsetTop}' role='button'>`
        const h3Start = `<h3 lang='en-${VFStr}'>`
        const h2Start = `<h2 lang='en-${VFStr}'>`

        console.log("App: ", $(".kix-appview-editor").scrollTop(), " Offset: ", text_element.offsetTop);

        if (change["type"] === "text") {
            const fromText = change["original"] === "" ? "There was no text before the change." : change["original"];
            const toText = change["text"] === "" ? "The text was removed after the change." : change["text"];
            const searchText = toText === "" ? fromText : toText;

            let text_tts = `${h2Start}Text Change ${i+1}</h2>`
            text_tts += `${h3Start}Change Type:</h3>${buttonStart}${change["change"]}</button><br>`
            text_tts += `${h3Start}Before Change:</h3>${buttonStart}${fromText}</button><br>`
            text_tts += `${h3Start}After Change:</h3>${buttonStart}${toText}</button><br>`
            text_tts += `${h3Start}Location:</h3>${buttonStart}${change["location"]} of page ${change["page"]}</button><br>`
            text_tts += `<button data-text='${searchText}' data-scroll='${text_element.offsetTop + $(".kix-appview-editor").scrollTop()}'class='navigate_button' role='button'>Copy Text to Clipboard</button>`

            text_strings.push(text_tts);
        }
        else if (change["type"] === "style") {
            if (change["text"].includes(">") || change["text"].includes("<")) {
                let error_tts = `${h2Start}Style Change ${i+1}</h2>`
                error_tts += `${h3Start}Style Change failed to parse correctly. Please try again.</h3><br>`
                text_strings.push(error_tts);
            }
            else {
                let text_tts = `${h2Start}Style Change ${i+1}</h2>`
                text_tts += `${h3Start}Changed Text:</h3>${buttonStart}${change["text"]}</button><br>`

                let changeText = ""
                let fromText = ""
                let toText = ""
                change["change"].forEach(detail => {
                    // CONCISE MODE
                    if (settings_config.mode === "Concise") {
                        if ("original" in detail && detail["original"] !== "") {
                            fromText += `${buttonStart}${detail["attribute"]}: ${detail["original"]}</button><br>`
                        }
                        
                        toText += `${buttonStart}${detail["attribute"]}: ${detail["result"]}</button><br>`
                    }

                    // NARRATIVE MODE
                    else {
                        if ("original" in detail && detail["original"] !== "") {
                            changeText += `The ${detail["attribute"]} was changed from ${detail["original"]} to ${detail["result"]}. `
                        }
                        else {
                            changeText += `The ${detail["attribute"]} was changed to ${detail["result"]}. `
                        }                    
                    }
                })

                // CONCISE MODE
                if (settings_config.mode === "Concise") {
                    text_tts += `${h3Start}From:</h3>${fromText}<br>`
                    text_tts += `${h3Start}To:</h3>${toText}<br>`
                }

                // NARRATIVE MODE
                else {
                    text_tts += `${h3Start}Change Details:</h3>${buttonStart}${changeText}</button><br>`
                }

                text_tts += `${h3Start}Location:</h3>${buttonStart}${change["location"]} of page ${change["page"]}</button><br>`
                text_tts += `<button data-text='${change["text"]}' data-scroll='${text_element.offsetTop + $(".kix-appview-editor").scrollTop()}'class='navigate_button' role='button'>Copy Text to Clipboard</button>`
                text_strings.push(text_tts);
            }
        }
    })

    return text_strings
}

//////////////////////////////////////////////////////////////////////////////////////////////
/// SETTINGS DISPLAY AND CONFIGURATIONS
//////////////////////////////////////////////////////////////////////////////////////////////
let settings_config = {
    speed: 1,
    accent: "US",
    gender: "Female",
    mode: "Concise",
    direction: "LR",
    material: "outside",
    room: {width: 1, height: 1, depth: 1}
}

function showSettings() {
    console.log("Opening Settings");
    focusElement = document.activeElement;

    // Get all the elements to manipulate
    var body = document.getElementsByTagName("body");
    var landmarks = document.querySelectorAll("header, main, footer");
    var overlay = document.getElementById("settingsModal");  
    var settings = document.getElementById("main_settings");  
    // Hide the content regions from AT
    for (var i = 0; i < landmarks.length; i++) {
    landmarks[i].setAttribute("aria-hidden","true");
    landmarks[i].setAttribute("inert","");
    }
    // Hide the content behind the overlay
    overlay.style.display = "block";
    // Add click handler to overlay
    // Kill the page scroll
    body[0].style.overflow = "hidden";
    // Set the dialog to modal
    settings.setAttribute("aria-modal","true");
    // dialog.setAttribute("data-id",eID);
    settings.removeAttribute("hidden"); 
    // Put focus on the close button
    // Normally I would put it on the modal, but this fits
    $(".modal_close").on('click', function() {
        hideSettings();
    });

    settings.focus();
    openSettingsTab("collabally_settings");
}

function hideSettings() {
    try {
        console.log("Closing Settings");
          // Get all the elements to manipulate
          var body = document.getElementsByTagName("body");
          var landmarks = document.querySelectorAll("header, main, footer");
          var overlay = document.getElementById("settingsModal");  
          var settings = document.getElementById("main_settings");  
          // Make the regions available to AT
          for (var i = 0; i < landmarks.length; i++) {
            landmarks[i].removeAttribute("aria-hidden");
            landmarks[i].removeAttribute("inert");
          }
          // Remove the overlay
          overlay.style.display = "none";
          // Return the scrollbar
          body[0].style.overflow = "auto";
          // Kill the dialog
          settings.removeAttribute("aria-modal");
          settings.removeAttribute("data-id");
          settings.setAttribute("hidden","");
    
          // Return focus to trigger
          console.log('FocusElement: ', focusElement);
          focusElement.focus();
    
    } catch (e) {
        console.log("Close Settings Error: " + e);
    }
}

function updateSettings() {
    // Set room settings
    dimensions.small = settings_config.room;
    materialSelection = settings_config.material;
    scene.setRoomProperties(dimensions[dimensionSelection],
    materials[materialSelection]);
    hideSettings();
}

function storeNewSettings(advanced = false) {
    if (advanced) {
        settings_config.room.width = $('#room_width').val()
        settings_config.room.height = $('#room_height').val()
        settings_config.room.depth = $('#room_depth').val()
        settings_config.material = $('input[name="material"]:checked').val();

    }
    else {
        settings_config.mode = $('input[name="delivery"]:checked').val(); // $('#delivery').val()
        settings_config.gender = $('input[name="gender"]:checked').val(); // $('#gender').val()
        settings_config.accent = $('input[name="accent"]:checked').val(); // $('#accent').val()
        settings_config.direction = $('input[name="direction"]:checked').val(); // $('#direction').val()
        settings_config.speed = $('#tts_speed').val()
    }
    
    console.log("Storing values: ", settings_config);

    updateSettings();
}

function openSettingsTab(changeName) {
    var i;
    var x = document.getElementsByClassName("settings_tab");
    for (i = 0; i < x.length; i++) {
        x[i].style.display = "none";
    }

    var tabs = document.getElementsByClassName("tab_button");
    for(let j = 0; j < tabs.length; j++) {
        tabs[j].setAttribute("aria-pressed", "false");
    }

    document.getElementById(changeName).style.display = "block";
    document.getElementById(`tab_${changeName}`).setAttribute("aria-pressed", "true");
}

//////////////////////////////////////////////////////////////////////////////////////////////
/// INITIALIZING FUNCTIONS
//////////////////////////////////////////////////////////////////////////////////////////////
function initializeConnection() {
    console.log("Connected to Python Server");
    initAudio();
    initKeycodes();
    initScroll();
}

let DialogTrigger = "";
function initKeycodes() {
    console.log ("Initializing Key Codes...");
    document.onkeydown = function(evt) {
        evt = evt || window.event;
        var isEscape = false;
        if ("key" in evt) {
          isEscape = evt.key == "Escape" || evt.key == "Esc";
        } else {
          isEscape = evt.keyCode == 27;
        }
        if (isEscape) {
          CloseDialog();
          storeNewSettings(); // general
          storeNewSettings(true); // advanced
        }
    }
}

function initializeModal() {
    $('body').append('<div id="dialog"></div>')
    $('#dialog').load(chrome.runtime.getURL('/dialog.html'), function() {
        loadingModal();
        
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function(event) {
            if (event.target == document.getElementById("myModal")) {
                $('#myModal').css('display', "none");
            }
        }
    });

    $('body').append('<div id="settings"></div>')
    $('#settings').load(chrome.runtime.getURL('/settings.html'), function() {
        $('#settingsModal').css('display', 'none');

        $('.modal_close').click(function() {
            $('#myModal').css('display', "none");
            $('#settingsModal').css('display', 'none');
        });
        
        // When the user clicks anywhere outside of the modal, close it
        window.onclick = function(event) {
            if (event.target == document.getElementById("settingsModal")) {
                $('#settingsModal').css('display', "none");
            }
        }

        $('.settings_slider').on('input', function() {
            let val = $(this).val();
            let output_id = $(this).attr("id").split('_')[1];
            $('#'+output_id).text(val);
        })

        $('#collabally_settings').off('submit').submit(function(e) {
            e.preventDefault();
            storeNewSettings();
        })

        $('#collabally_advanced').off('submit').submit(function(e) {
            e.preventDefault();
            storeNewSettings(true);
        })

        $("#tab_collabally_advanced").on('click', function() {
            openSettingsTab('collabally_advanced');
        });
    
        $("#tab_collabally_settings").on('click', function() {
            openSettingsTab('collabally_settings');

        })

        $('#TTS_preview').click(function(e) {
            e.preventDefault();
            let temp_gender = $('input[name="gender"]:checked').val();
            let temp_accent = $('input[name="accent"]:checked').val();

            let tts_voice = tts_lang_map[`en-${temp_accent}`][temp_gender];
            sendMessage({"tts_str": "This will be your CollabAlly voice.", "tts_lang": `en-${temp_accent}`, "speed": $('#tts_speed').val(), "tts_voice": tts_voice}, "POST", `${host_ipv4}/dialog_to_speech`, function(err, resp) {
                if (err === null && audioReady) {
                    interruptAudio();
    
                    let mediaResp = JSON.parse(resp);
                    console.log("Text to Speech Response: ", mediaResp, " from ", resp);
    
                    playDialogTTS("This will be your CollabAlly voice.", mediaResp[0], {x: 0, y: 0});
                }
            });
        })
    });
}

let tts_lang_map = {
    'en-US': {"Female": "en-US-Standard-C", "Male": "en-US-Standard-A"}, // "en-US-Standard-C" for female
    'en-GB': {"Female": "en-GB-Standard-A", "Male": "en-GB-Standard-B"}, // "en-GB-Standard-B" for male
    'en-AU': {"Female": "en-AU-Standard-A", "Male": "en-AU-Standard-B"}, // "en-AU-Standard-A" for female
    'en-IN': {"Female": "en-IN-Standard-D", "Male": "en-IN-Standard-C"}  // "en-IN-Standard-C" for male
}

//////////////////////////////////////////////////////////////////////////////////////////////
/// SCROLL HELPER FUNCTIONS (USED TO MANUALLY SCROLL THROUGH DOCUMENT TO GET UPDATED HTML ELEMENTS)
//////////////////////////////////////////////////////////////////////////////////////////////
const SCROLL_DELAY = 10;
function initScroll() {
    $(".kix-appview-editor").on('scroll', function() {
        if (TTSPlaying && summarySoundSource !== undefined && _audioIndex > 0) {
            setAudioViewportPosition(summarySoundSource);
        }
    })

    setTimeout(function() {
        initScrollMore(0);
    }, SCROLL_DELAY);
}

function quickScroll(height, originalHeight, onComplete) {
    if (height < $(".kix-zoomdocumentplugin-outer").height() - $(".kix-appview-editor").height()) {
        setTimeout(function() {
            console.log("Scroll Down");
            $(".kix-appview-editor").scrollTop(height);
            quickScroll(height + $(".kix-appview-editor").height(), originalHeight, onComplete);
        }, SCROLL_DELAY);
    }
    else {
        setTimeout(function() {
            console.log( "Scroll Top" );
            $(".kix-appview-editor").scrollTop(originalHeight);
            onComplete();
        }, SCROLL_DELAY);
    }
}

let play_async_summary = false;
function initScrollMore(height) {
    if (height < $(".kix-zoomdocumentplugin-outer").height() - $(".kix-appview-editor").height()) {
        setTimeout(function() {
            console.log("Scroll Down");
            $(".kix-appview-editor").scrollTop(height);
            initScrollMore(height + $(".kix-appview-editor").height());
        }, SCROLL_DELAY);
    }
    else {
        setTimeout(function() {
            console.log( "Scroll Top" );
            $(".kix-appview-editor").scrollTop(0);
            
            // For Async
            setTimeout(function() {
                updateDocumentState();
                console.log("Getting Async");
                sendMessage({"comments": commentMap, "page_info": docHTMLContextJSON, "doc_url": currentURL, "collaborators": collabState}, "POST", `${host_ipv4}/get_async_diff`, function(err, resp) {
                    if (err === null && audioReady) {
                        TTSPlaying = false;        
                        let mediaResp = JSON.parse(resp);
                        console.log("Text to Speech Response: ", mediaResp);        
                        console.log("HTML Document Map: ", docHTMLElementMap);

                        collabTTS();
                        commentTTS();

                        const now = Date.now();
                        if ("async_changes" in mediaResp && "summary" in mediaResp["async_changes"]) {
                            async_changes = parseText(mediaResp["async_changes"]);
                            if ("history" in mediaResp) {
                                for (const [date, text_change] of Object.entries(mediaResp["history"])) {
                                    asyncTimeMap[new Date(parseInt(date))] = text_change
                                }
                                console.log("Async Map: ", asyncTimeMap);

                                prior_changes = []
                                const h1Start = `<h1 lang='en-${settings_config.accent}'>`
                                const h3Start = `<h3 lang='en-${settings_config.accent}'>`
                                const pStart = `<p lang='en-${settings_config.accent}'>`
                                Object.keys(asyncTimeMap).sort((a, b) => b - a).forEach(date => {
                                    const old_change = asyncTimeMap[date];
                                    changes = parseText(old_change);

                                    prior_changes = prior_changes.concat(changes);
                                });

                                if (prior_changes.length > 0) {
                                    prior_changes[0] = `${h1Start}Changes from Last Login</h1>` + prior_changes[0];
                                }

                                async_changes = async_changes.concat(prior_changes);
                                async_summary_tts = `${h1Start}Text Summary</h1>`
                                summaryObj = mediaResp["async_changes"]["summary"];

                                // CONCISE MODE
                                if (settings_config.mode === 'Concise') {
                                    async_summary_tts += `${h3Start}Total Text Changes:</h3>${pStart}${summaryObj["text"]}</p>`
                                    async_summary_tts += `${h3Start}Total Style Changes:</h3>${pStart}${summaryObj["style"]}</p>`
                                    for (const [page, count] of Object.entries(summaryObj["page"])) {
                                        async_summary_tts += `${h3Start}Page ${page}:</h3>${pStart}${count} change${count === 1 ? "" : "s"}</p>`
                                    }
                                }
                                // NARRATIVE MODE
                                else {
                                    let page_detail = ""
                                    for (const [page, count] in Object.entries(summaryObj["page"])) {
                                        let change_str = count > 1 ? "changes are" : "change is"
                                        page_detail += `${count} ${change_str} in page ${page}. `
                                    }
                                    async_summary_tts += `Since you last queried this tool, there have been ${summaryObj["style"]} style change${summaryObj["style"] === 1 ? "" : "s"} and ${summaryObj["text"]} text change${summaryObj["text"] === 1 ? "" : "s"} in the document. ${page_detail}`;
                                }

                                updateModal("Text", async_changes, async_summary_tts);
                            }
                        }
                        else {
                            updateModalStatus(["Welcome to the CollabAlly tool. It appears that this is the first time you are accessing this document. Please take some time to familiarize yourself with the controls and structure of the dialog box."]);
                        }

                        openChange("Collaborators");
                    }
                });

                socketReady = true;
            }, SCROLL_DELAY);
        }, SCROLL_DELAY);
    }
}
