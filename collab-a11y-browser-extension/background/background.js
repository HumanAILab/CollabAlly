chrome.commands.onCommand.addListener((command) => {
  console.log("Command: ", command);

  // Trigger keyboard shortcut for now
  // Shift+Alt+0
  if (command === 'connectSocket') {
      chrome.tabs.query(
          {currentWindow: true, active : true},
          function(tabs) {
              console.log("Connecting to Socket at Tab", tabs);
              chrome.tabs.sendMessage(tabs[0].id, {
                  message: "connectSocket",
                  url: tabs[0].url,
                }, function(response) {
                  // alert(response);
                })
          }
      )
  }

  // Shift+Alt+1
  else if (command === 'displayModal') {
    chrome.tabs.query(
      {currentWindow: true, active : true},
      function(tabs) {
          console.log("displaying modal at Tab", tabs[0].id);
          chrome.tabs.sendMessage(tabs[0].id, {
              message: "displayModal",
              url: tabs[0].url,
            }, function(response) {
              // alert(response);
            })
      }
    )
  }

  // Shift+Alt+2
  else if (command === 'showSettings') {
    chrome.tabs.query(
      {currentWindow: true, active : true},
      function(tabs) {
          console.log("Showing settings at Tab", tabs[0].id);
          chrome.tabs.sendMessage(tabs[0].id, {
              message: "showSettings",
              url: tabs[0].url,
            }, function(response) {
              // alert(response);
            })
      }
    )
  }
})


// FOR CHROME
// chrome.runtime.onConnect.addListener(port => {
//   console.log('Connected Background.js to port', port);
//   chrome.runtime.onMessage.addListener((req, sender, res) => {
//     if (req.message === "getCollaborators") {
//         chrome.tabs.query(
//             {currentWindow: true, active : true},
//             function(tabs) {
//                 // console.log("tab", tabs[0].id);
//                 chrome.tabs.sendMessage(tabs[0].id, {
//                     message: "getCollaborators",
//                     url: tabs[0].url,
//                   }, function(response) {
//                     // alert(response);
//                   })
//             }
//           )
//     }
//   });
// });

chrome.runtime.onMessage.addListener((req, sender, res) => {
  if (req.message === "getCollaborators") {
      chrome.tabs.query(
          {currentWindow: true, active : true},
          function(tabs) {
              // console.log("tab", tabs[0].id);
              chrome.tabs.sendMessage(tabs[0].id, {
                  message: "getCollaborators",
                  url: tabs[0].url,
                }, function(response) {
                  // alert(response);
                })
          }
        )
  }

  // else if (req.message === "closeExtension") {
  //   console.log("Detected new message");
  //   var xhr = new XMLHttpRequest();
  //   xhr.open("POST", `https://collabally.humanailab.com/close_extension`, true);
  //   xhr.setRequestHeader('Content-Type', 'application/json');
  //   xhr.send(JSON.stringify({"comments": req.comments, "url": req.url, "collaborators": req.collaborators, "history": req.text}));
  // }
  // else if (req.message === 'update_popup') {
  //   console.log("Update Popup Message: ", {subject: req.subject, content: req.content});
  //   chrome.runtime.sendMessage({subject: req.subject, content: req.content, message: 'update_popup'});
  // }
});

chrome.runtime.onConnect.addListener(port => {
  console.log('Connected Background.js to port', port);
  chrome.tabs.query(
    {currentWindow: true, active : true},
    function(tabs) {
        console.log("Connected to port: ", tabs);
        chrome.tabs.sendMessage(tabs[0].id, {
            message: "connectSocket",
            url: tabs[0].url,
          }, function(response) {
            // alert(response);
          })
    }
  )
});
