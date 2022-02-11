# collab-a11y-backend
CollabAlly is a system that makes collaboration awareness in document editing accessible to blind users. CollabAlly extracts collaborator, comment, and text-change information and their context from a document and presents them in a dialog box to provide easy access and navigation.

### Current Feature Overview
1. Use of distinct earcons that indicate when and where the following collaboration activities occur in the document:
    1. When a collaborator has entered and exited the document. In the current state of CollabAlly, exiting the document and being idle in the document are considered identical and thereby treated as such.
    2. When a collaborator has added or removed a comment. In the current state of CollabAlly, deleting a comment and resolving a comment are considered identical and thereby treated as such.
    3. When a collaborator's cursor has moved within 5 lines from the user's cursor, or moved away from the user's cursor after entering within 5 lines.
2. A dialog box that can be accessed through a finite set of pre-defined keyboard shortcuts, that provide comprehensive information about different collaborator activities since the user entered the document and/or last opened the dialog box. Information varies based on the type of collaboration activity, as follows:
    1. Collaborator Changes:
        1. Collaborator Name
        2. Location of Collaborator's Cursor (page number and location on page (top, center, bottom))
        3. Line of text that the Collaborator's Cursor is on in the document
    2. Comment Changes:
        1. Name of Comment Author
        2. Location of Selected Text for Comment (page number and location on page (top, center, bottom))
        3. Selected text that the Comment is referring to
        4. Date Comment was made
        5. Content of Comment itself
    3. Text and Style Changes:
        1. One of the two types of changes can be made to the text in the document: a text change, where text can either be inserted or deleted from the document; or a style change, where the visual features of the text was modified.
        2. The location of the change.
        3. The content (or style) of the text before the change was made.
        4. The content (or style) of the text after the change was made.
3. For detailed information about each collaborator activities, CollabAlly provides Text-To-Speech (TTS) features to have the information read aloud in the Voicefont that was defined by the collaborators themselves. For demo and implementation purposes, this has been predefined in the code. 
4. Use of spatial audio techniques to pan earcons and TTS audio in a certain direction based on whether the corresponding change was made above the user's cursor, or below the user's cursor. Directionality can be modified in a separate settings menu, but defaults to Left to Right (pans left if change is below the user's cursor, right if change is above the user's cursor).
5. A backend system to maintain persistent information of the state of the Google Document after the user exits the document. Upon re-entering the document, CollabAlly fetches the stored state and compares it with the most recent version of the document, thereby offering 

### Immediate Features to Implement
1. Fixing heading hierarchy, information architecture, and phrasing of certain types of changes of dialog box based on user feedback from evaluative user research.
2. Debugging and fixing reliability issues with backend system for parsing text and style changes.
3. Checking and verifying spatial audio panning issues that sometimes occur with TTS audio
4. Resolving issues with incorrect page numbering for comments when additional text is added on the last page of the document (specficially when it is added in a bulleted list)

### Long Term Features to Incorporate
1. Developing a more comprehensive earcon system of distinguishing:
    1. Collaborators leaving vs. Collaborators that are idle
    2. Deleting comments vs resolving Comments
2. Providing real-time earcon feedback for any collaboration activity anywhere in the document (currently only limited to the changes that are visible within the user's viewport)
3. Offering more contextual information about the text changes and style changes that have been added, such as:
    1. The type of text that is being edited (heading, sentence, paragraph, list, table)
    2. Mapping CSS changes to understandable style changes (size of text increased, color changed, font was bolded, etc.)
    3. Support for more types of changes (e.g. images, tables, charts, footnotes)
4. Providing more scalable options for multiple collaborators using CollabAlly simultaneously in same document.
5. Providing more support for sighted users to use CollabAlly
6. Extending features and support of CollabAlly beyond Google Docs (e.g. Overleaf)

### Features to be Integrated with existing Tools
Many of the limitations of CollabAlly stem from lack of direct access to Google Docs, Chrome and/or Screenreader code. To enhance support, the following integrations are necessary.
1. Direct mapping of voicefonts to screenreader vocalizer features, to directly read out collaborator changes in the accent and gender of the voice that the collaborator chooses. 
2. Using spatial audio/panning features built into screenreaders that allow more distinct spatial audio changes to audio
3. Direct access to Google Docs API to access text changes and states in the document (i.e. version control information)

## Overview
The following Python server leverages Google's Diff-Match-Patch library to parse and fetch text changes in the Google Doc. It maintains an internal state of the collaborative environment that is used to compare the HTML of the document through the mobilebasic document URL. Using the library, it then iterates through each of the changes and parses it through regex expressions into a readable and understandable format. The information is then organized as a JSON object that is sent back to the browser extension. Due to limitations with the mobilebasic version of the website, as well as the limitations of Google's Diff-Match-Patch library, the following features are known bugs in the system:
* HTML Elements being displayed in the front-end dialog box
* Comments in the document cannot be resolved, and edited text in highlighted comment sections may not be correctly parsed.
* Repeated CSS/Stylistic features being displayed in the dialog box

As we fix these bugs and also iterate on the backend, we also hope to incorporate the following features into our system:
* Identifying the author that made the change, approximated based on their cursor position relative to the line in the document that was updated.
* Communicating CSS changes in a more accessible and user-friendly format, informed by additional studies with blind users. 

## Setup instructions for Python Server
0. Before you run the project, you need to fetch the Google Cloud credentials json file and put it in your local directory (Github doesn't let you upload private credential keys onto the repo because there is a security risk). Please create a credential file of your own (https://cloud.google.com/docs/authentication/getting-started) and add it to the local directory.

Also, in the local directory, create a folder called 'media'. Download this folder from the Google Drive https://drive.google.com/drive/folders/1hkTikL1HZB6gNgx5PIsmxQVD4UurqNIv?usp=sharing and then add it into the 'media' folder (so file path should be ./media/implicit_audio).

1. Update the host_url with your local IPV4 address for your computer in server.py
2. Install all python modules and dependencies using pip install -r requirements.txt
3. Run python server.py (using Python 3)

## Setup instructions for Resonance Audio Cursor Events (DEPRECATED)
1. Navigate to Server/examples/resources/js/room-models.js
2. Add your local IPV4 address for your computer in line 8
3. Run the file on Chrome (or any browser) by disabling web security (to bypass the CORS error); see https://alfilatov.com/posts/run-chrome-without-cors/
4. If you connect your AirPods/headset to your computer, and you play the audio file on Server/examples/room-models.html, you can change the location of the spatialized audio by scrolling and moving your cursor

## Setup instructions for iOS Resonance Audio Application (DEPRECATED)
1. Make sure you have XCode 12 installed (latest version is available on App Store)
2. Open AirPodsProMotion.xcworkspace in XCode. Make sure the Cocoapods file is updated by running pod update and pod install in the terminal
3. Configure the URL string in Line 40 of AirPodsProMotion/AirPodsProMotion/InformationViewController.swift to your computer's IPV4 address (assuming your phone is connected to the same network as your computer)
4. Ensure that the target device for iOS is 14.0 or above
5. Connect an iOS device running on iOS 14.0 or above to your computer and build the project (if there are errors of "no such module" then it will go away once you build and deploy the application on your device)
6. Connect your AirPods before running the application 
