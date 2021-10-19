## collab-a11y-browser-extension

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
        1. 
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

### Installation
1. In Firefox, type "about:config"
2. Search for security.fileuri.strict_origin_policy and set it to false (Note: this will disable Cross Origin errors, for local debugging and testing)
3. Search for security.csp.enable and set it to false (Note: this should only be used for debugging and testing local files)
4. Go to "about:debugging#/runtime/this-firefox" and use "Load Temporary Add-on...". Click "manifest.json" and load the extension

### Current files

1. manifest.json: Configurations, permissions of this extension
2. background/background.js: The script that runs in the background
3. content/content.js: The script that runs in each opened tab

### Current functions

0. Press "Alt+S" (in windows) or "Option+S" (in mac) to establish a connection with the Python server. Press "Alt+T" (in windows) or "Option+T" (in mac) to play the audio (currently set default to bird-1.wav)
1. Press "Alt+R" (in windows) or "Option+R" (in mac) when you're inside a Google doc. **Note that pressing this shortcut inside of the WYSIWYG editor will be typing a special character, please try it when you're outside of the edito**r. You can see results in the browser console.
2. The results contains: 
    1. User's own cursor position, 
    2. All collaborators' positions, 
    3. Every combination of 2 users inside of this doc and their common parent HTML node (which could indicate which same element they are in right now), 
    4. A list of elements each user is in.
3. Press "Alt+C" to read audio comments from the document (NOTE: If the audio is incorrect, clear cache from the Firefox browser)
    

### TODO
1. Currently it only works for elements in the invisible range and no scrolling. So we need to find the scrolling number and set it in content.js, line 21.
2. We also need to translate the common parent HTML node into our own language, like if it's the page div that means they are in the same page.
3. By doing 1&2 we will have a N*N matrix telling the common element every two users are in together. Send this 2d array via Socket and generate spatial audio.
