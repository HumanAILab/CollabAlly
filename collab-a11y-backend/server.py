from flask import Flask, request, render_template, send_file
from flask_socketio import SocketIO, emit
from flask_cors import CORS, cross_origin
from datetime import datetime
import os
import json
import itertools

from bs4 import BeautifulSoup
from lxml.html.diff import htmldiff, html_annotate
import urllib.request
import requests
import difflib
import diff_match_patch as dmp_module
import time
import re
import asyncio

from flask_pymongo import PyMongo
from google.cloud import texttospeech

from stateTracker import *

# Google Application Credentials: Please change this to your own credential file
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "REMOVED_FOR_SECURITY"

loop = asyncio.get_event_loop()
app = Flask(__name__, template_folder='../')
host_url = "10.0.0.191"
# host_url = "0.0.0.0"
airpodJSON = {}

clients = []
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app)

cors = CORS(app)
app.config['CORS_HEADERS'] = 'Content-Type'

# MongoDB setup
# For me: run ./mongod --dbpath=./data/db
app.config["MONGO_URI"] = "mongodb://localhost:27017/myDB"
mongo = PyMongo(app)

########################################################################################
### WEB HOOK HELPER FUNCTIONS
########################################################################################
@app.route('/')
def hello_world():
    return 'Hello, World!'

@app.route('/text_to_speech', methods=['POST'])
def handle_text_to_speech():
    # text_change, tts = fetch_updated_diff(request.json["page_info"], request.json["collaborators"], "")
    text_change = fetch_updated_diff(request.json["page_info"], request.json["collaborators"], "")
    print("Sending updated text: ", text_change)

    # COLLAB CHANGES
    update_log("timestamp", datetime.now().strftime("%Y%m%d%H%M%S"))
    update_log("participant", "1")
    update_log("action", "fetch_collab")
    update_log("output", json.dumps(request.json["collaborators"]))
    update_log("state", json.dumps(request.json["collaborators"]))
    log_data()

    # TEXT CHANGES
    update_log("timestamp", datetime.now().strftime("%Y%m%d%H%M%S"))
    update_log("participant", "1")
    update_log("action", "fetch_text")
    update_log("output", json.dumps(text_change))
    update_log("state", json.dumps(request.json["collaborators"]))
    log_data()

    # COMMENT CHANGES
    update_log("timestamp", datetime.now().strftime("%Y%m%d%H%M%S"))
    update_log("participant", "1")
    update_log("action", "fetch_comments")
    update_log("output", json.dumps(request.json["comments"]))
    update_log("state", json.dumps(request.json["collaborators"]))
    log_data()

    return json.dumps(text_change)

@app.route('/dialog_to_speech', methods=['POST'])
def handle_dialog_tts():
    print("Found Request: ", request.json)
    now = datetime.now()
    tts_path = "tts_{}.mp3".format(now.strftime("%Y%m%d%H%M%S"))
    synthesize_text_custom(request.json["tts_str"], 
                        "./media/{}".format(tts_path), 
                        request.json["tts_lang"], 
                        request.json["tts_voice"],
                        float(request.json["speed"]))
    return json.dumps([tts_path])

@app.route('/set_doc_url', methods=['POST'])
def set_doc_url():
    if "https://docs.google.com" in request.form['doc_url']:
        print("Found URL: ", request.form['doc_url'])
        setURL(request.form['doc_url'].split("edit")[0] + "mobilebasic")
        return "Success"
    
    return "Fail"

@cross_origin()
@app.route('/get_audio', methods=['GET'])
def handle_get_audio():
    filename = request.args.get('name')
    print("Fetching audio file: ./media/{}".format(filename))
    try:
	    return send_file('./media/{}'.format(filename), attachment_filename = filename)
    except Exception as e:
	    return str(e)

# Update: we are not handling unread comments (i.e. no point to read a deleted/resolved comment)
# TODO: See whether there is a use case to add a "dummy" entry
@app.route('/close_extension', methods=['POST'])
def handle_close_tab():
    print("Closing Tab...storing async state: ", request.json)
    # add_log_entry("Closing Document", request.json["collaborators"], [])

    tempData = getURLString(doc_url)
    currentRecord = mongo.db.docs.find_one({"url": doc_url})

    if currentRecord is None:
        mongo.db.docs.insert_one({  "url": doc_url, 
                                    "content": tempData, 
                                    "history": request.json["history"],
                                    "comments": request.json["comments"],
                                    "collaborators": request.json["collaborators"]
                                })
    else:
        mongo.db.docs.update_one({"url": doc_url}, {"$set": {
                                                            "content": tempData,
                                                            "history": request.json["history"],
                                                            "comments": request.json["comments"],
                                                            "collaborators": request.json["collaborators"]
                                                        }
                                    })

    # write_logs_to_file()
    return "Close Success"

@app.route('/get_async_diff', methods=['POST'])
def handle_db_diff():
    print("Checking async...fetching changes: ", request.json)
    if "https://docs.google.com" in request.json['doc_url']:
        print("Found URL: ", request.json['doc_url'])
        setURL(request.json['doc_url'].split("edit")[0] + "mobilebasic")

    start_new_log()
    prevRecord = mongo.db.docs.find_one({"url": doc_url})

    if prevRecord:
        if "content" in prevRecord:
            # change_text, tts = fetch_updated_diff(request.json["page_info"], {}, prevRecord["content"], True)
            # text_num = len(change_text) - 1
            # text_audio_arr = change_text[1:] if len(change_text) > 1 else []
            change_text = fetch_updated_diff(request.json["page_info"], {}, prevRecord["content"], True)

            # TEXT CHANGES
            update_log("timestamp", datetime.now().strftime("%Y%m%d%H%M%S"))
            update_log("participant", "1")
            update_log("action", "fetch_text")
            update_log("output", json.dumps(change_text))
            update_log("state", json.dumps(request.json["collaborators"]))
            log_data()

            return json.dumps({"async_changes": change_text, "history": prevRecord["history"]})


    # COLLAB CHANGES
    update_log("timestamp", datetime.now().strftime("%Y%m%d%H%M%S"))
    update_log("participant", "1")
    update_log("action", "fetch_collab")
    update_log("output", json.dumps(request.json["collaborators"]))
    update_log("state", json.dumps(request.json["collaborators"]))
    log_data()

    # COMMENT CHANGES
    update_log("timestamp", datetime.now().strftime("%Y%m%d%H%M%S"))
    update_log("participant", "1")
    update_log("action", "fetch_comments")
    update_log("output", json.dumps(request.json["comments"]))
    update_log("state", json.dumps(request.json["collaborators"]))
    log_data()

    return json.dumps({})

########################################################################################
### TEXT TO SPEECH HELPER
########################################################################################
def comment_to_text(author, comment):
    # print("Comment: {}".format(comment.keys()))
    audioStr = ""

    # First create audio file for root element
    if len(comment['docText']) < 2:
        context = "The line in the document that reads, {}".format(comment['docText'][0])
    else:
        context = "The section in the document beginning with the line, {}, and ending in the line, {}".format(comment['docText'][0], comment['docText'][-1])

    audioStr += "At {}, {} commented, '{}', in response to {}.".format(comment['time'], author, comment['comment'], context)

    # Then create the replies
    for reply in comment['reply']:
        audioStr += "then at {}, {} responded with, '{}'.".format(reply['time'], reply['author'], reply['comment'])

    return audioStr

# Originally from https://cloud.google.com/text-to-speech/docs/create-audio#text-to-speech-text-python
def synthesize_text(text, path):
    """Synthesizes speech from the input string of text."""
    print("Transforming {} into speech".format(text))
    client = texttospeech.TextToSpeechClient()

    input_text = texttospeech.SynthesisInput(text=text)

    # Note: the voice can also be specified by name.
    # Names of voices can be retrieved with client.list_voices().
    voice = texttospeech.VoiceSelectionParams(
        language_code="en-US",
        name="en-US-Standard-C",
        ssml_gender=texttospeech.SsmlVoiceGender.FEMALE,
    )

    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3
    )

    response = client.synthesize_speech(
        request={"input": input_text, "voice": voice, "audio_config": audio_config}
    )

    # The response's audio_content is binary.
    with open(path, "wb") as out:
        out.write(response.audio_content)
        print('Audio content written to file "{}"'.format(path))

def synthesize_text_custom(text, path, lang, name, speed):
    """Synthesizes speech from the input string of text."""
    print("Transforming {} into speech, with lang {} and name {}".format(text, lang, name))
    client = texttospeech.TextToSpeechClient()

    input_text = texttospeech.SynthesisInput(text=text)

    # Note: the voice can also be specified by name.
    # Names of voices can be retrieved with client.list_voices().
    voice = texttospeech.VoiceSelectionParams(
        language_code=lang,
        name=name,
        ssml_gender=texttospeech.SsmlVoiceGender.FEMALE,
    )

    audio_config = texttospeech.AudioConfig(
        audio_encoding=texttospeech.AudioEncoding.MP3,
        speaking_rate = speed
    )

    response = client.synthesize_speech(
        request={"input": input_text, "voice": voice, "audio_config": audio_config}
    )

    # The response's audio_content is binary.
    with open(path, "wb") as out:
        out.write(response.audio_content)
        print('Audio content written to file "{}"'.format(path))

########################################################################################
### FOR LOGGING
########################################################################################
log_behavior = []
log_prefixes = {
    "timestamp": "",
    "participant": "",
    "action": "",
    "output": "",
    "state": ""
}

log_file = ""
def start_new_log():
    global log_file
    if not os.path.exists('logs'):
        os.makedirs('logs')
    
    log_file = "{}.txt".format(datetime.now().strftime("%Y%m%d%H%M%S"))
    try:
        with open(os.path.join("logs/", log_file), 'a') as temp_file:
            for prefix in log_prefixes.keys():
                temp_file.write(prefix + ",")
    except:
        e = traceback.format_exc()
        print(e)

def update_log(key, value):
    try:
        log_prefixes[key] = value
    except:
        e = traceback.format_exc()
        print(e)

def log_data():
    try:
        with open(os.path.join("logs/", log_file), 'a') as temp_file:
            for val in log_prefixes.values():
                temp_file.write(val + ",")
    except:
        e = traceback.format_exc()
        print(e)

if __name__ == "__main__":
    # app.run(debug=True, port=443, host=host_url, ssl_context=('/etc/letsencrypt/live/collabally.humanailab.com/fullchain.pem', '/etc/letsencrypt/live/collabally.humanailab.com/privkey.pem')) #run app in debug mode on port 5000
    app.run(debug=True, port=5000, host=host_url) #run app in debug mode on port 5000