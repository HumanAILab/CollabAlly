from bs4 import BeautifulSoup
from lxml.html.diff import htmldiff, html_annotate
from datetime import datetime

import sys
import traceback
import urllib.request
import requests
import difflib
import time
import re
import os
import diff_match_patch as dmp_module

from google.cloud import texttospeech
import webcolors
from webcolors import css3_hex_to_names, hex_to_rgb

# Google Application Credentials: Please change this to your own credential file
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "REMOVED_FOR_SECURITY"

# CollabAlly Default document link: Please make sure it's ended with 'mobilebasic', which is the link you will get if you open the document via your mobile devices
doc_url = "PLEASE_CHANGE_TO_YOUR_DOC_LINK"


# See https://github.com/google/diff-match-patch/wiki/Language:-Python
dmp = dmp_module.diff_match_patch()

########################################################################################
### COLOR UTILITY FUNCTIONS
########################################################################################
# Webcolor conversion; originally from https://stackoverflow.com/questions/9694165/convert-rgb-color-to-english-color-name-like-green-with-python
def closest_colour(requested_colour):
    min_colours = {}
    for key, name in css3_hex_to_names.items():
        r_c, g_c, b_c = webcolors.hex_to_rgb(key)
        rd = (r_c - requested_colour[0]) ** 2
        gd = (g_c - requested_colour[1]) ** 2
        bd = (b_c - requested_colour[2]) ** 2
        min_colours[(rd + gd + bd)] = name
    return min_colours[min(min_colours.keys())]

def get_colour_name(color_str):
    color_tuple = (int(color_str[0:2], 16), int(color_str[2:4], 16), int(color_str[4:6], 16))
    try:
        closest_name = actual_name = webcolors.rgb_to_name(color_tuple)
    except ValueError:
        closest_name = closest_colour(color_tuple)
        actual_name = None
    return actual_name, closest_name

# requested_colour = (119, 172, 152)
# actual_name, closest_name = get_colour_name(requested_colour)

# print "Actual colour name:", actual_name, ", closest colour name:", closest_name

########################################################################################
### TEXT TO SPEECH UTILITY FUNCTIONS
########################################################################################
def setURL(newURL):
    global doc_url
    doc_url = newURL

text_tts_strings = {"details": [], "summary": ""}
def get_change_summary():
    global text_tts_strings
    page_change_map = {}
    style_count = 0
    text_count = 0
    for item in changes:
        # print("Summary Item: ", item)
        if item["style"]:
            style_count += 1
            if item["context"]["page"] and item["context"]["page"] in page_change_map:
                page_change_map[item["context"]["page"]] += 1
            elif item["context"]["page"] not in page_change_map:
                page_change_map[item["context"]["page"]] = 1
        elif item["text"]:
            text_count += 1
            if item["context"]["page"] and item["context"]["page"] in page_change_map:
                page_change_map[item["context"]["page"]] += 1
            elif item["context"]["page"] not in page_change_map:
                page_change_map[item["context"]["page"]] = 1
        elif item["original"]:
            text_count += 1
            item["type"] = "Delete"

    page_detail_str = ""
    for page, count in page_change_map.items():
        change_str = "changes are" if count > 1 else "change is"
        page_detail_str += "{} {} in page {}. ".format(count, change_str, page)
    # summary_str = "change_summary_{}.mp3".format(datetime.now().strftime("%Y%m%d%H%M%S"))
    # text_summary_tts = "Since you last queried this tool, there have been {} style change{} and {} text change{} in the document. {}".format(style_count, "s" if style_count != 1 else "", text_count, "s" if text_count != 1 else "", page_detail_str)
    # synthesize_text(text_summary_tts, "./media/{}".format(summary_str))
    # text_tts_strings.append(text_summary_tts)
    text_tts_strings["summary"] = {"page": page_change_map, 
                                    "style": style_count,
                                    "text": text_count}
    # return summary_str

def get_individual_changes():
    # Aggregate style changes based on body
    style_change_map = {}
    text_changes_list = []
    text_audio_paths = []
    for c in changes:
        if c["style"]:
            if "body" not in c:
                print("Invalid style summary item: ", c)
                continue                
            elif c["body"] not in style_change_map.keys():
                style_change_map[c["body"]] = [c]
            else:
                style_change_map[c["body"]].append(c)
        elif c["text"]:
            if not c["original"]:
                c["type"] = "Insert"
            text_changes_list.append(c)
        elif c["original"]:
            c["type"] = "Delete"
            text_changes_list.append(c)

    style_id = 0
    for key, value in style_change_map.items():
        style_change_to_speech(value, key, value[0]["context"], style_id)
        # text_audio_paths.append(style_change_to_speech(value, key, value[0]["context"], style_id))
        style_id += 1

    text_id = 0
    for text in text_changes_list:
        text_change_to_speech(text, text_id)
        # text_audio_paths.append(text_change_to_speech(text, text_id))
        text_id += 1

    return text_audio_paths

def style_change_to_speech(change, text, context, id):
    global text_tts_strings
    style_detail_str = ""
    style_detail_dict = []
    for c in change:
        if c["style"][-1] == ';':
            c["style"] = c["style"][:-1]

        new_map = create_style_map(c["style"])
        og_map = create_style_map(c["original"])

        if c["type"] == "Insert" or c["type"] == "Replace":
            for attr, value in new_map.items():
                value_og = ""
                if attr == "color":
                    actual, value = get_colour_name(value[1:])

                if attr in og_map:
                    if attr == "color":
                        actual_og, value_og = get_colour_name(og_map[attr][1:])
                    else:
                        value_og = og_map[attr]

                if value_og and value_og != value:
                    value_og = value_og.split("'>")[0] if "'>" in value_og else value_og
                    value = value.split("'>")[0] if "'>" in value else value
                    # style_detail_str += "The {} was changed from {} to {}. ".format(attr, value_og, value)
                    style_detail_dict.append({"attribute": attr, "original": value_og, "result": value})
                elif value_og != value:
                    value = value.split("'>")[0] if "'>" in value else value
                    # style_detail_str += "The {} was changed to {}. ".format(attr, value)
                    style_detail_dict.append({"attribute": attr, "result": value})

        elif c["type"] == "Delete":
            for attr, val in new_map.items():
            # elements = c["style"].split(";")
            # for style in elements:
            #     if style and ":" in style:
            #         attr = style.split(":")[0]
            #         value = style.split(":")[-1]

            #         if "color" in attr:
            #             actual, value = get_colour_name(value[1:])

                # style_detail_str += "The {} was removed. ".format(attr)
                style_detail_dict.append({"attribute": attr, "result": ""})

    # style_path = "style_change_{}_{}_{}_{}.mp3".format(change[0]["context"]["coordinates"][0],
    #                                                 change[0]["context"]["coordinates"][1],
    #                                                 id, datetime.now().strftime("%Y%m%d%H%M%S"))
    text = text.split("</")[0] if "</" in text else text
    text = style_element_end_2_regex.sub('', text)
    # text = simplify_text_string(text)
    # style_speech = "At the {} of page {}, the {} beginning with the line, {}, had {} style change{}. {}".format(context["location"], context["page"], context["parent"], text, len(change), "s" if len(change) != 1 else "", style_detail_str)
    style_speech = {"type": "style",
                    "location": context["location"],
                    "page": context["page"],
                    "parent": context["parent"],
                    "coordinates": context["coordinates"],
                    "number": len(change),
                    "text": text,
                    "change": style_detail_dict}

    text_tts_strings.setdefault("details", []).append(style_speech)
    # synthesize_text(style_speech, "./media/{}".format(style_path))
    # return style_path
    return style_speech

def create_style_map(style_str):
    style_map = {}
    # Split the style string by semicolons
    attributes = style_str.split(';')
    for attr in attributes:
        if attr:
            # Split the attribute by name and value
            name_val = attr.split(':')
            style_map[name_val[0]] = name_val[1]

    # print("Style Map: ", style_map)
    return style_map

def text_change_to_speech(change, id):
    global text_tts_strings
    change_str = ""
    text_change_dict = []
    if change["type"] == "Insert":
        change_str = "Text was inserted into the document."
        change["text"] = get_all_text_tags(change["text"]) if text_block_regex.search(change["text"]) else change["text"]
        # change["text"] = change["text"][2:-2] if "'>" in change["text"][:2] else change["text"][:-2]
    elif change["type"] == "Delete":
        change_str = "Text was deleted from the document."
        change["text"] = get_all_text_tags(change["text"]) if text_block_regex.search(change["text"]) else change["text"]
        # change["text"] = change["text"][2:-2] if "'>" in change["text"][:2] else change["text"][:-2]
    else:
        # change_str = change_str[:-2]
        change["original"] = change["original"][2:-2] if "'>" in change["original"][:2] else change["original"]
        change_str = "Text was modified."

    # text_path = "text_change_{}_{}_{}_{}.mp3".format(change["context"]["coordinates"][0],
    #                                                 change["context"]["coordinates"][1],
    #                                                 id, datetime.now().strftime("%Y%m%d%H%M%S"))
    new_text = change["text"]# simplify_text_string(change["text"])
    og_text = change["original"]# simplify_text_string(change["original"])
    # text_speech = "At the {} of page {}, the {} beginning with the line, {}, was {}".format(change["context"]["location"], change["context"]["page"], change["context"]["parent"] if change["context"]["parent"] else "text", 
    # og_text if change["type"] != "Insert" else new_text, change_str)
    
    text_tts_strings.setdefault("details", []).append({
        "type": "text",
        "text": new_text,
        "original": og_text,
        "location": change["context"]["location"],
        "page": change["context"]["page"],
        "parent": change["context"]["parent"] if change["context"]["parent"] else "text",
        "change": change_str,
        "coordinates": change["context"]["coordinates"],
    })
    # synthesize_text(text_speech, "./media/{}".format(text_path))
    # return text_path
    # return text_speech

MAX_WORDS = 10
def simplify_text_string(text_string):
    comma_index = -1
    period_index = -1
    words = text_string.split(' ')
    if ',' in text_string:
        comma_index = text_string.index(',')
    
    if '.' in text_string:
        period_index = text_string.index('.')
    
    if comma_index > 0 and period_index > 0:
        if comma_index < period_index:
            words = text_string.split(',')
        else:
            words = text_string.split('.')

        return words[0]
    elif comma_index > 0:
        words = text_string.split(',')
        return words[0]
    elif period_index > 0:
        words = text_string.split('.')
        return words[0]

    words = words[:MAX_WORDS] if len(words) >= MAX_WORDS else words
    return " ".join(words) 

def get_all_text_tags(text_tags):
    appeared_comments = []
    text_str = ""
    text_tags = comment_superscript_regex.sub('', comment_footer_regex.sub('', text_tags))
    print("Text after removing comments: ", text_tags)
    text_list = text_block_regex.findall(text_tags)
    # tag_list = tag_start_regex.findall(text_tags)
    # j = 0
    # for i in range(len(tag_list)):
    #     if j >= len(text_list):
    #         break

    #     tag = tag_list[i]
    #     text = text_list[j]
    #     print("Tag number ",  i, ": ", tag, " Text: ", text)
    #     if "span" in tag:
    #         if "'>" in text or '">' in text:
    #             text_str += text[2:-2]
    #         elif ">" in text:
    #             text_str += text[1:-2]
    #         else:
    #             text[:-2]

    #         text_str += " "
    #         j += 1
    #     elif 'id="cmnt' in tag:
    #         if tag in appeared_comments: # Ignore the current superscript and the subsequent comment text block
    #             j += 2
    #         else:
    #             appeared_comments.append(tag)
    #             j += 1
    for text in text_list:
        if "'>" in text or '">' in text:
            text_str += text[2:]# text[2:-2]
        elif ">" in text:
            text_str += text[1:]# text[1:-2]
        else:
            text_str += text# text[:-2]

        text_str += " "

    return text_str


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

########################################################################################
### URL EXTRACTION UTILITY FUNCTIONS
########################################################################################
def getURLString(url):
    req = requests.get(url, headers)
    gdoc_website = BeautifulSoup(req.content, 'html.parser').find('div', class_='doc')
    gdoc_div = gdoc_website.find('div')
    gdoc_content = gdoc_div.findAll(['p', 'ol', 'ul', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
    data = [str(x) for x in gdoc_content]
    return ''.join(data)

def getURLHTML(url):
    req = requests.get(url, headers)
    data = BeautifulSoup(req.content, 'html.parser').find_all("span")
    data = [str(x) for x in data]
    return data

d = difflib.Differ()
headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600',
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:52.0) Gecko/20100101 Firefox/52.0'
    }

changes = []
prevData = ""
page_context = []
doc_collabs = {}
# sleepTime = 3
currentPage = (0, 0)
initialized = False

########################################################################################
### REGEX
########################################################################################
# REGEX EXPRESSIONS
# Classify tags, tag names, and style attributes
open_nameless_tag_regex = re.compile(r"<$")
open_text_tag_regex = re.compile(r"<[a-zA-Z0-9\s:;\=\'\"\-\\\#\.]+>$")
tag_name_regex = re.compile(r"<[a-zA-Z]+")
tag_closed_regex = re.compile(r"<[a-zA-Z0-9\s:;\=\'\"\-\\\#\.]+>")
tag_start_regex = re.compile(r"<[a-zA-Z\s=\"\';:0-9#\-\_\&\.]+")
tag_style_regex = re.compile(r"style=[\"\'][a-zA-Z\:\#0-9\;\-\&\"\.]+\"")
tag_style_start = re.compile(r"style=[\"\'][a-zA-Z\:\#0-9\;\-\&\"\.]*")
tag_style_start_2 = re.compile(r"^\s?style=[\"\'][a-zA-Z\:\#0-9\;\-\&\"\.]*")
tag_style_element = re.compile(r"<[a-zA-Z]+\sstyle=")

# Classify style elements, style end, and style syntax
open_style_tag_regex = re.compile(r"<[a-zA-Z0-9\s:;\=\'\"\-\\\#\.]+$")
style_element_regex = re.compile(r"[a-z\-A-Z0-9]+:?[a-zA-Z0-9\s\#]*")
style_element_2_regex = re.compile(r"<[a-zA-Z]*\sstyle=[\'\"]?")
style_element_end_regex = re.compile(r"^[a-zA-Z0-9\-\#\'\"]*;")
style_element_end_2_regex = re.compile(r"^[a-zA-Z0-9\=\-\#:;\'\"]*[\'\"]?>")
style_end_tag_regex = re.compile(r"^[a-zA-Z\-0-9:;#\"\'\=]*[\'\"]?\>")
style_end_tag_2_regex = re.compile(r"^\s?style=[a-zA-Z\-0-9:;#\"\']*[\'\"]?\>")
style_end_2_regex = re.compile(r"^[a-zA-Z\-0-9:;#\"\']*[\'\"]?")
style_no_quotes_regex = re.compile(r"[a-zA-Z\-0-9:;#]")
style_insert_tag_regex = re.compile(r"<\/[a-zA-Z]*><[a-zA-Z]+\s*[a-zA-Z0-9\=\"\'\:\#\;\-\.\,\(\)]*>[a-zA-Z0-9:;\,\.\s\"\'\-\^\&\\\$\%\*\&\(\)\!\@\[\]\{\}\’\?]*")

# Classify text block and incomplete text blocks
text_block_regex = re.compile(r"[\'\"]?\>[a-zA-Z0-9:;\,\.\s\"\'\-\^\&\\\$\%\*\&\(\)\!\@\[\]\{\}\’\?]+\<\/")
incomplete_text_blocks = re.compile(r"[\"\']?\>[a-zA-Z0-9:;\,\.\s\"\'\^\&\\\$\%\*\&\(\)\!\@\[\]\{\}]+(?:(?!\<\/)?)")
text_block_end = re.compile(r"^[a-zA-Z0-9:;\,\.\s\"\'\^\&\\\$\%\*\&\(\)\!\@\[\]\{\}]*(?:(?!\<\/)?)")
text_block_end_2 = re.compile(r">[a-zA-Z0-9\,\.\/\\\!\&\;\:\'\"\+\-\s\_\=\(\)\[\]]+$")
# html_open_tag = re.compile(r"<[a-zA-Z]+ [a-zA-Z0-9\=\"\'\;\.\_\-\:\#]*>")
# html_close_tag = re.compile(r"<\/[a-zA-Z]+>")

# Classify Comment Blocks
comment_superscript_regex = re.compile(r"<?sup><a href=\"\#cmnt[0-9]+\" id=\"cmnt_ref[0-9]+\">[a-zA-Z0-9\[\]]+<\/a><\/sup>")
comment_footer_regex = re.compile(r"<?a href=\"\#cmnt_ref[0-9]+\" id=\"cmnt[0-9]+\">[a-zA-Z0-9\[\]]+<\/a><span[a-zA-Z0-9\s\=:;\"\'\#\\\-]+>[a-zA-Z0-9\,\.:;\s\&\[\]\?\*\!\'\/\(\)]+<\/span>")
comment_content_regex = re.compile(r"<span[a-zA-Z0-9\s\=:;\"\'\#\\\-]+>[a-zA-Z0-9\,\.:;\s\&\[\]\?\*\!\'\/\(\)]+<\/span>")

# Classify href attribute
href_element_regex = re.compile(r"href=[\"\']")

tag_context_map = {
    'p': "Paragraph",
    'ol': "Ordered List Element",
    'ul': "Unordered List Element",
    'h1': 'Main Header',
    'h2': 'Header',
    'h3': 'Sub-header',
    'h4': 'Sub-header',
    'h5': 'Sub-header',
    'h6': 'Sub-header'
}

mobilebasic_comment_tags = {}

########################################################################################
### STATE TRACKER UTILITY FUNCTIONS
########################################################################################
def filterUniCodeCharacters(text_str):
    text_en = text_str.encode("ascii", "ignore")
    return text_en.decode()

def extractChangeDetails(context, change):
    global currentPage
    # Check if the change string itself has a tag (if so we are directly inserting/deleting a tag)
    print("\t\t\textractChangeDetails- Change: ", change, " with context: ", context)
    detail = {"text": "", "style": "", "type": "", "original": ""}
    inline_context = getTagContext(change)
    # if 'id="cmnt' in change:
    #     return detail

    if inline_context["tag"] and inline_context["parent"]:
        # Entire thing was inserted/deleted
        print("\t\t\textractChangeDetails- Inline text change detected: ", change)
        detail["text"] = filterUniCodeCharacters(change)
    else:
        style_changes = tag_style_regex.findall(context["tag"])
        style_tags = tag_style_element.findall(context["tag"])
        href_changes = href_element_regex.findall(context["tag"])
        if  (len(style_changes) > 0 or len(style_tags) == 0):
            # Style is completely defined, so the only change is text
            print("\t\t\textractChangeDetails- Text Change detected: ", change)
            detail["text"] = filterUniCodeCharacters(change)
        elif len(href_changes) == 0:
            # This is a style change
            print("\t\t\textractChangeDetails- Style change detected: ", change)
            detail["style"] = context["tag"].split("=")[-1][1:] + change

    # Get context for change based on page number
    if currentPage[1] >= len(page_context[currentPage[0]]):
        currentPage = (currentPage[0] + 1, 0)

    detail["context"] = get_page_context()
    detail["context"]["parent"] = context["parent"]
    # print("Resulting change: ", detail)
    return detail

def get_page_context():
    global currentPage
    print("\t\t\tget_page_context- Current page context: ", currentPage)
    ratio = currentPage[1]/len(page_context[currentPage[0]])
    pagePosition = "bottom" if ratio > 0.6 else "center" if ratio > 0.3 else "top"

    # matched = False
    # author_str = ""
    # for name, state in doc_collabs.items():
    #     if state["page"] == currentPage[0]+1 and state["context"] == pagePosition:
    #         author_str = name
    #         matched = True
    #         break
    return {"page": currentPage[0] + 1, "location": pagePosition, "coordinates": [currentPage[0], currentPage[1]]} 
    # {"author": author_str, "page": currentPage[0]+1, "location": pagePosition} # Array is 0 indexed but Page starts at 1

def checkEndStrIncludedInArr(arr, endStr):
    for end in arr:
        if end in endStr or endStr in end:
            return True

    return False


def extractStyleReplacement(deleteArr, insertArr, context, diff):
    changeObj = {}
    print("\t\t\textractStyleReplacement- Insert Arr:", insertArr, " Delete Arr: ", deleteArr, " Diff: ", diff[1])
    if (len(deleteArr) > 0 or len(insertArr) > 0):
        # Case 1: Both inserted and deleted (replacement)
        if len(deleteArr) > 0 and len(insertArr) > 0:
            print("Style Replacement detected: ", diff[1])
            end_str = getEndStyleElement(diff[1])

            insertStr = "".join(insertArr) + end_str
            if checkEndStrIncludedInArr(insertArr, end_str):
                insertStr = "".join(insertArr)
                
            deleteStr = "".join(deleteArr) + end_str
            if checkEndStrIncludedInArr(deleteArr, end_str):
                deleteStr = "".join(deleteArr)

            print("end_str: ", end_str)

            for context_str in reversed(context["style"].split(';')):
                if context_str:
                    changeObj = extractChangeDetails(context, insertStr)
                    changeObj["type"] = "Replace"
                    changeObj["original"] = filterUniCodeCharacters(context_str + deleteStr)
                    break

            if len(context["style"]) == 0:
                if 'style="' in context["tag"] and context["tag"][-1] == '"':
                    context["tag"] = context["tag"][:-1]
                changeObj = extractChangeDetails(context, end_str)
                changeObj["type"] = "Replace"
                changeObj["original"] = ""

        # Case 2: Just inserted
        elif len(insertArr) > 0:
            print("Style Insertion detected: ", diff[1])
            end_str = getEndStyleElement(diff[1])
            insertStr = "".join(insertArr) + end_str
            if checkEndStrIncludedInArr(insertArr, end_str):
                insertStr = "".join(insertArr)

            if 'style="' in context["tag"] and context["tag"][-1] == '"':
                    context["tag"] = context["tag"][:-1]

            changeObj = extractChangeDetails(context, insertStr)
            changeObj["type"] = "Insert"

        # Case 3: Just deleted
        else:
            print("Style Deletion detected: ", diff[1])
            end_str = getEndStyleElement(diff[1])
            deleteStr = "".join(deleteArr) + end_str
            if checkEndStrIncludedInArr(deleteArr, end_str):
                deleteStr = "".join(deleteArr)

            if 'style="' in context["tag"] and context["tag"][-1] == '"':
                    context["tag"] = context["tag"][:-1]

            changeObj = extractChangeDetails(context, deleteStr)
            changeObj["type"] = "Delete"

    print("Style Change Object: ", changeObj)
    return changeObj

def extractTextReplacement(deleteArr, insertArr, originalArr, context):
    changeObj = {}
    if (len(deleteArr) > 0 or len(insertArr) > 0):
        # Case 1: Both inserted and deleted (replacement)
        if len(deleteArr) > 0 and len(insertArr) > 0:
            # print("Text Replacement detected: ", insertArr)
            insertStr = "".join(insertArr)
            deleteStr = "".join(deleteArr)

            changeObj = extractChangeDetails(context, context["text"] + insertStr)
            changeObj["type"] = "Replace"
            changeObj["original"] = filterUniCodeCharacters(context["text"] + deleteStr)

        # Case 2: Just inserted
        elif len(insertArr) > 0:
            print("Text Insertion detected: ", insertArr)
            insertStr = "".join(insertArr)
            originalStr = "".join(originalArr)

            changeObj = extractChangeDetails(context, context["text"] + insertStr)
            changeObj["type"] = "Insert"
            changeObj["original"] = filterUniCodeCharacters(context["text"] + originalStr)

        # Case 3: Just deleted
        else:
            print("Text Deletion detected: ", deleteArr)
            deleteStr = "".join(deleteArr)
            originalStr = "".join(originalArr)

            changeObj = extractChangeDetails(context, context["text"] + originalStr)
            changeObj["type"] = "Delete"
            changeObj["original"] = filterUniCodeCharacters(context["text"] + deleteStr)

    return changeObj

def extractComments(doc_str):
    comment_text = []
    comments = comment_footer_regex.findall(doc_str)
    print("String: " + doc_str + " with regex: ", comments)
    for c in comments:
        # print(c)
        text_str = ""
        for text in comment_content_regex.findall(c):
            text_str += text.split(">")[1].split("</span")[0]
        comment_text.append(text_str)

    return comment_text

def pruneComments(doc_str):
    doc_str = re.sub(r"<?sup><a href=\"\#cmnt[0-9]+\" id=\"cmnt_ref[0-9]+\">[a-zA-Z0-9\[\]]+<\/a><\/sup>", "", doc_str)
    doc_str = re.sub(r"<?a href=\"\#cmnt_ref[0-9]+\" id=\"cmnt[0-9]+\">[a-zA-Z0-9\[\]]+<\/a><span[a-zA-Z0-9\s\=:;\"\'\#\\\-]+>[a-zA-Z0-9\,\.:;\s\&\[\]\?\*\!\'\/\(\)]+<\/span>", "", doc_str)
    # doc_str = re.sub(r"<span[a-zA-Z0-9\s\=:;\"\'\#\\\-]+>[a-zA-Z0-9\,\.:;\s\&\[\]\?\*\!\'\/\(\)]+<\/span>", "", doc_str)
    return doc_str

# An element is a style change if the tag is open and this is not an HREF tag
def isStyleChange(style_tag):
    return (len(tag_style_regex.findall(style_tag)) == 0 
            and len(href_element_regex.findall(style_tag)) == 0
            and len(tag_style_start.findall(style_tag)) > 0)

def styleTagEmbeddedInText(text):
    return len(style_insert_tag_regex.findall(text)) > 0

def lastTagOpen(text_string):
    open_tags = tag_start_regex.findall(text_string) # See if tag is in current string
    closed_tags = tag_closed_regex.findall(text_string)
    return (len(open_tags) != len(closed_tags) and len(open_style_tag_regex.findall(text_string)) > 0)

def noStyleElement(tag_str):
    return len(tag_style_element.findall(tag_str)) == 0

def tagHasEnded(tagString):
    return len(style_end_tag_regex.findall(tagString)) > 0 or len(style_end_tag_2_regex.findall(tagString)) > 0

def tagWithStyleEnded(tagString):
    return len(style_end_tag_2_regex.findall(tagString)) == 1

def isTextChange(textString):
    return (len(text_block_regex.findall(textString)) < len(incomplete_text_blocks.findall(textString)) or len(open_text_tag_regex.findall(textString)) > 0)

def endWithOpenTag(textString):
    return len(open_nameless_tag_regex.findall(textString)) > 0

def getLastIncompleteTextBlock(textString):
    text = incomplete_text_blocks.findall(textString)
    return text[-1].split('>')[-1] if len(text) > 0 else ""

def getTextBlockEnd(textString):
    print("\t\t\tgetTextBlockEnd- Text Block has Ended: ", text_block_end.findall(textString))

    text_str = text_block_end.search(textString)
    return text_str.group() if text_str else ""

def textBlockEndExists(textString):
    return len(text_block_end.findall(textString)) > 0

def styleElementHasEnded(styleString):
    print("\t\t\tstyleElementHasEnded- Style Attribute Has Ended: ", style_element_end_regex.findall(styleString))
    return len(style_element_end_regex.findall(styleString)) > 0

def styleElementWithTag(styleString):
    # print("\t\t\tstyleElementWithTag- Style Element With Tag: ", style_element_end_2_regex.findall(styleString), " String: ", styleString)
    return len(style_element_end_2_regex.findall(styleString)) > 0

def getEndStyleElement(styleString):
    print("\t\t\tgetEndStyleElement- End Element: ", style_end_2_regex.search(styleString))
    return style_end_2_regex.search(styleString).group() if style_end_2_regex.search(styleString) else ""

def styleInElementStart(styleString):
    # print("Start Element: ", tag_style_start_2.search(styleString))
    return tag_style_start_2.search(styleString).group() if tag_style_start_2.search(styleString) else ""

def getFirstTextBlock(tagString):
    text = text_block_regex.search(tagString)
    text_alt = incomplete_text_blocks.search(tagString)
    text_search = text.group()[:-2].split('>')[-1] if text else ""
    text_alt_search = text_alt.group().split(">")[-1] if text_alt else ""
    return text_alt_search if text_alt_search else text_search

def textBlockExistsInString(currString):
    print("\t\t\ttextBlockExistsInString- Text Block Exists in String: ", text_block_regex.findall(currString))
    return len(text_block_regex.findall(currString)) > 0

def getTagContext(current_str):
    curr_tags = tag_start_regex.findall(current_str) # See if tag is in current string
    print("\t\t\tgetTagContext- Current string is: ", current_str, " with regex: ", curr_tags)
    if len(curr_tags) > 0 and validTagContext(curr_tags[-1]):
        # Get the last tag in the unchanged string to figure out what was changed
        return {"tag": curr_tags[-1], "parent": getTagParent(curr_tags[:-1], curr_tags[-1])}
    else:
        return {"tag": "", "parent": ""}

def validTagContext(current_str):
    return len(href_element_regex.findall(current_str)) == 0

def getTagParent(tag_list, current_tag):
    parentTag = ""
    current_tag = tag_name_regex.search(current_tag).group()[1:]
    # print("Current Tag: ", current_tag)
    if current_tag in tag_context_map.keys():
        parentTag = current_tag
    elif "span" == current_tag:
        for tag in reversed(tag_list):
            tag = tag_name_regex.search(tag).group()[1:]
            if "span" == tag: # <a> are normally nested in <span> or otherwise they are comments
                break
            elif tag in tag_context_map.keys():
                parentTag = tag
                break
            elif "li" == tag:
                continue
            parentTag = tag
    elif "a" == current_tag:
        for tag in reversed(tag_list):
            tag = tag_name_regex.search(tag).group()[1:]
            if "li" == tag or "span" == tag:
                continue
            parentTag = tag
            break
    parentTag = tag_context_map[parentTag] if parentTag and parentTag in tag_context_map else ""
    # print("Parent Tag: ", parentTag)
    return parentTag

def checkCommentLink(current_tag):
    return 'id="cmnt' in current_tag

def getLastTagStyleContext(style_tag, style_str):
    # If the style tag is open then this string is most likely an element in the style
    if isStyleChange(style_tag):
        # print("Extracting style string: ", style_str)
        style_elements = style_element_regex.findall(style_str)
        return style_elements[-1] if len(style_elements) > 0 else ""

    return ""

def getAllTagStyleContexts(style_tag, style_str):
    # if isStyleChange(style_tag):
    style_elements = style_element_regex.findall(style_str)
    return ";".join(style_elements)

    return ""

def getAllChanges(diffArr):
    # Context for getting the differences
    context = {"tag": "", "parent": "", "style": "", "text": ""}

    # Object for reporting delete changes
    deleteChange = {}

    # Object for reporting insert changes
    insertChange = {}

    # Array for recording results
    changeReport = []

    # Array for recording style changes
    styleChangeReport = []

    # Accumulated strings for checking style
    styleDeleteString = []
    styleInsertString = []

    # Accumulated strings for checking text
    textDeleteString = []
    textInsertString = []
    textOriginalString = []

    # State machine variables 
    justDeleted = False # If we just updated the deleteChange obj in previous iteration
    justInserted = False # If we just updated the insertChange obj in previous iteration
    styleChange = False # If change is a change in the style="" attr
    textChange = False # If change is insertions and deletions within a single span/spans of text
    findStyleTextContext = False # If style block ended but we still haven't found the corresponding text for that style
    openNamelessTag = False 

    for diff in diffArr:
        diff_temp = diff[1].encode("ascii", "ignore")
        diff = (diff[0], pruneComments(diff_temp.decode()))

        # Case 1: The diff string is unchanged
        if diff[0] == 0:
            print("\r\n\r\ngetAllChanges- Found unchanged: ", diff[1], " styleChange=", styleChange, " textChange=", textChange)
            if justDeleted:
                justDeleted = False
                if deleteChange["text"] or deleteChange["style"]:
                    changeReport.append(deleteChange)

            if justInserted:
                justInserted = False
                if insertChange["text"] or insertChange["style"]:
                    changeReport.append(insertChange)

            # Get the new context from the unchanged string
            temp = getTagContext(diff[1])

            # If we are in a style attribute within a tag then we are modifying the style of the string
            if styleChange:
                if styleElementHasEnded(diff[1]):
                    print("\tgetAllChanges (unchanged)- Style element has ended. Continuing style change regex...")
                    endStr = style_element_end_regex.findall(diff[1])[0]
                    styleDeleteString.append(endStr)
                    styleInsertString.append(endStr)

                    insertChange = extractStyleReplacement(styleDeleteString, styleInsertString, context, diff)
                    if "type" in insertChange:
                        styleChangeReport.append(insertChange)

                    styleInsertString.clear()
                    styleDeleteString.clear()

                    if not styleElementWithTag(diff[1]):
                        temp["tag"] = style_element_2_regex.findall(context["tag"])[0]
                        temp["tag"] += diff[1].split(';')[-1]
                elif context["style"] and not tagHasEnded(diff[1]):
                    print("\tgetAllChanges (unchanged)- Style element has not ended. Appending style string to everything...")
                    # style_context_str = getAllTagStyleContexts(context["tag"], diff[1])
                    style_context_str = diff[1] # style_context_str if style_context_str else diff[1]

                    styleDeleteString.append(style_context_str)
                    styleInsertString.append(style_context_str)

                # Once the style change is complete, then the next "unchanged" string will have the closing tag
                # We search for the closing tag to obtain the subsequent block of text that the style was applied to 
                if tagHasEnded(diff[1]):
                    styleChange = False
                    textChange = handle_style_change(styleChangeReport, changeReport, styleDeleteString, styleInsertString, context, diff)
                    if not (textChange and len(styleChangeReport) > 0 and 'body' in styleChangeReport[-1] and styleChangeReport[-1]['body']):
                        print("\tgetAllChanges (unchanged)- Style Change Text Context not found. Proceed search in next loop iteration")
                        findStyleTextContext = True

            # Check whether the number of open text tags match the number of closed ones (if not then there is a text change)
            if textChange:
                # There are niche cases where the tag is replaced without the tag opening e.g. ol class="..." so we add one
                if openNamelessTag:
                    diff = (diff[0], "</p><" + diff[1])
                    openNamelessTag = False
                
                findStyleTextContext = handle_text_change(changeReport, styleChangeReport, textDeleteString, textInsertString, textOriginalString, styleInsertString, styleDeleteString, diff, context, findStyleTextContext)
                textChange = False
 
            if isTextChange(diff[1]) and tagHasEnded(temp["tag"]):
                textChange = True
                context["text"] = diff[1].split('>')[-1]

            context["tag"] = temp["tag"] if temp["tag"] else context["tag"]
            context["parent"] = temp["parent"] if temp["parent"] else context["parent"]
            temp_style = getLastTagStyleContext(context["tag"], diff[1])
            context["style"] = temp_style if temp_style else context["style"]

            # After we extract the changes, we update page number that we are in
            update_current_page(diff[1])

        # Case 2: We are deleting parts of the original string
        elif diff[0] == -1:
            print("\r\n\r\ngetAllChanges- Deletion detected: ", diff[1])
            print("\tgetAllChanges (deletion)- Deletion context: ", context, " with styleChange=", styleChange, "; textChange=", textChange)
            print("\tgetAllChanges (deletion)- Checking for Style Change in Deletion")
            if not styleChange and not textChange:
                styleChange = isStyleChange(diff[1]) or styleTagEmbeddedInText(diff[1])
                textChange = isTextChange(diff[1])

            print("\tgetAllChanges (Deletion)- Updated styleChange=", styleChange, "; textChange=", textChange)

            # Check to see if it is a style change
            if styleChange:
                style_context_str = diff[1]
                if noStyleElement(context["tag"]):
                    temp = styleInElementStart(diff[1])
                    style_context_str = temp if temp else diff[1]
                    # Case 1: Style is in the beginning so we are removing all the style elements
                    if style_context_str != diff[1]: 
                        style_context_str = style_context_str.split('style=')[1]
                    # Case 2: Style is not in the beginning so we are inserting all the style elements
                    else: 
                        styleDeleteString.append('')

                if styleElementWithTag(style_context_str):
                    regex = style_element_end_2_regex.findall(style_context_str)[0].split(">")[0]
                    print("\tgetAllChanges (deletion)- New regex: ", regex)
                    styleDeleteString.append(regex)
                    # styleChange = False
                    styleChange = len(style_element_end_2_regex.findall(style_context_str)) > 0
                    textChange = handle_style_change(styleChangeReport, changeReport, styleDeleteString, styleInsertString, context, (0, style_context_str))
                # elif styleElementHasEnded(style_context_str):
                #     styleDeleteString.append(style_context_str)
                elif styleTagEmbeddedInText(style_context_str):
                    # Fetch the style information
                    print("\tgetAllChanges (deletion)- Embedded new tag")
                    styleDeleteString.append(tag_style_start.search(style_context_str).group())
                    styleChange = False
                    textChange = handle_style_change(styleChangeReport, changeReport, styleDeleteString, styleInsertString, context, (0, style_context_str))
                else:
                    print("\tgetAllChanges (deletion)- appending to delete style array...")
                    styleDeleteString.append(style_context_str)

            print("\tgetAllChanges (deletion)- Checking for Text Change in Deletion")
            # If there is no tag in the string, then it is a text change
            # TODO: Check for potential tags in the text where the style is different but the text is the same
            if textChange: # or not getTagContext(diff[1])["tag"]:
                # Check the style change in the text
                print("\tgetAllChanges (Deletion)- Text change detected")
                text = re.sub(r"<?[a-zA-Z]+ [a-zA-Z0-9\=\"\'\;\.\_\-\:\#]*>", "", diff[1])
                text = re.sub(r"<(\/[a-zA-Z]+>)?", "", text)
                
                textDeleteString.append(text)
                openNamelessTag = endWithOpenTag(diff[1])
                continue
            """
            else:
                deleteChange = extractChangeDetails(context, diff[1])
                deleteChange["type"] = "Delete"
                justDeleted = True
            """

        # Case 3: We are inserting new elements into the original string
        else:
            print("\r\n\r\ngetAllChanges- Insertion detected: ", diff[1])
            print("\tgetAllChanges (Insertion)- Insertion context: ", context, " with styleChange=", styleChange, "; textChange=", textChange)
            if not styleChange and not textChange:
                styleChange = isStyleChange(diff[1]) or styleTagEmbeddedInText(diff[1])
                textChange = isTextChange(diff[1])

            print("\tgetAllChanges (Insertion)- Updated styleChange=", styleChange, "; textChange=", textChange)
            print("\tgetAllChanges (Insertion)- Checking for Style Change in Insertion")

            if styleChange:
                style_context_str = diff[1]
                if noStyleElement(context["tag"]):
                    temp = styleInElementStart(diff[1])
                    style_context_str = temp if temp else diff[1]
                    if style_context_str != diff[1]: # Case 1: Style is in the beginning so we are removing all the style elements
                        style_context_str = style_context_str.split('style=')[1]
                    else: # Case 2: Style is not in the beginning so we are inserting all the style elements
                        styleInsertString.append('')

                if styleElementWithTag(style_context_str):
                    styleInsertString.append(style_element_end_2_regex.findall(style_context_str)[0])
                    styleChange = False
                    textChange = handle_style_change(styleChangeReport, changeReport, styleDeleteString, styleInsertString, context, (0, style_context_str))
                # elif styleElementHasEnded(style_context_str):
                #     styleInsertString.append(style_context_str)
                elif styleTagEmbeddedInText(style_context_str):
                    # Fetch the style information
                    print("\tgetAllChanges (Insertion)- Embedded new tag")
                    styleInsertString.append(tag_style_start.search(style_context_str).group())
                    styleChange = False
                    textChange = handle_style_change(styleChangeReport, changeReport, styleDeleteString, styleInsertString, context, (0, style_context_str))
                else:
                    print("\tgetAllChanges (Insertion)- appending to insert style array...")
                    styleInsertString.append(style_context_str)

            # If there is no tag in the string, then it is a text change
            print("\tgetAllChanges (Insertion)- Checking for Text Change in Insertion")
            temp_context = getTagContext(diff[1])
            # Case 1: We have a previously detected text change, or the current context has no tag(?)
            if textChange: # :
                print("\tgetAllChanges (Insertion)- Text change detected")
                # Ignore the style change in text
                text = re.sub(r"<?[a-zA-Z]+ [a-zA-Z0-9\=\"\'\;\.\_\-\:\#]*>", "", diff[1])
                text = re.sub(r"<(\/[a-zA-Z]+>)?", "", text)

                textInsertString.append(text)                
                openNamelessTag = endWithOpenTag(diff[1])
                # textChange = True
                continue
            # Case 2: Default we assume it is a text change so we set it as such
            """
            else:
                if temp_context["tag"]:
                    context = temp_context
                insertChange = extractChangeDetails(context, diff[1])
                insertChange["type"] = "Insert"
                justInserted = True
            """

            # Replace (by default, a delete followed immediately by an insert is a replacement)
            if justDeleted:
                print("\t\tgetAllChanges (Insertion)(text)- Replacement detected")
                justDeleted = False
                justInserted = False
                insertChange["type"] = "Replace"
                insertChange["original"] = deleteChange["text"] if deleteChange["text"] else deleteChange["style"]
                if insertChange["text"] or insertChange["style"] and insertChange["original"]:
                    if styleChange:
                        styleChangeReport.append(insertChange)
                    else:
                        changeReport.append(insertChange)
        
        # Check to see if the tag is open (if so, it is a style change)
        if isStyleChange(context["tag"]) or lastTagOpen(diff[1]):
            print("\tgetAllChanges (unchanged)- Style change detected for string!")
            styleChange = True
        elif isTextChange(diff[1]):
            print("\tgetAllChanges (unchanged)- Text change detected for string!")
            textChange = True
            if len(text_block_end_2.findall(diff[1])) > 0:
                print("\tgetAllChanges (unchanged)- Found beginning of text element. Appending...!")
                excessText = text_block_end_2.findall(diff[1])[-1].split('>')[-1]
                textInsertString.append(excessText)
                textDeleteString.append(excessText)
                textOriginalString.append(excessText)
        elif endWithOpenTag(diff[1]):
            print("\tgetAllChanges (unchanged)- Text change detected for string with open tag!")
            textChange = True
            openNamelessTag = True

    if justDeleted:
        justDeleted = False
        changeReport.append(deleteChange)

    if justInserted:
        justInserted = False
        changeReport.append(insertChange)

    # print("Change Report: ", changeReport)
    return changeReport

def handle_style_change(styleChangeReport, changeReport, styleDeleteString, styleInsertString, context, diff):
    print("\thandle_style_change- Style tag has ended. Generating style change report...")
    if ">" in diff[1]:
        # temp_tag_end = diff[1].split('>')[0]
        context["tag"] = context["tag"] + ' style="' if ('style="' in diff[1] and 'style=' not in context["tag"]) else context["tag"]
        diff = (diff[0], diff[1].split('style="')[1] if 'style="' in diff[1] else diff[1])
    insertChange = extractStyleReplacement(styleDeleteString, styleInsertString, context, diff)
    if "type" in insertChange:
        styleChangeReport.append(insertChange)

    styleInsertString.clear()
    styleDeleteString.clear()
    
    associatedText = getFirstTextBlock(diff[1])
    print("\thandle_style_change- Fetching first text block: ", associatedText)
    # get_context_from_str(associatedText) # Find the page number that this string is in
    # change_context = get_page_context()

    # Edge case: There is no text block because the text is also being modified
    # In this case, we wait on the text changes to be reported first before we add the changes
    if associatedText:
        update_current_page(diff[1])
        for change in styleChangeReport:
            change["body"] = associatedText
            # change["context"] = change_context
            changeReport.append(change)

        styleChangeReport.clear()
    elif not textBlockExistsInString(diff[1]):
        return True

    return False

def handle_text_change(changeReport, styleChangeReport, textDeleteString, textInsertString, textOriginalString, styleInsertString, styleDeleteString, diff, context, updateStyleContext):
    # If we have a closing tag, then we have ended the text change 
    end_str = getTextBlockEnd(diff[1])
    if end_str or textBlockEndExists(diff[1]):
        textDeleteString.append(end_str)
        textInsertString.append(end_str)
        textOriginalString.append(end_str)
        textChangeObj = extractTextReplacement(textDeleteString, textInsertString, textOriginalString, context)

        # Edge case: we are still finding the resulting style change so we need to append it to the most recent style block
        if updateStyleContext:
            print("\thandle_text_change- Text change object created. Previous style context still needs text context. Adding to style report...")
            update_current_page(diff[1])
            for change in styleChangeReport:
                change["body"] = textChangeObj['text']
                # change["context"] = change_context
                changeReport.append(change)

            styleChangeReport.clear()
            updateStyleContext = False
        
        # This is edge case where this is a style change followed by a text change
        if len(styleChangeReport) > 0:
            for change in styleChangeReport:
                change["body"] = textChangeObj["original"]
                # change["context"] = change_context
                changeReport.append(change)

            styleChangeReport.clear()
            styleInsertString.clear()
            styleDeleteString.clear()
        else:
            # textChangeObj["context"] = change_context
            changeReport.append(textChangeObj)
        
        # textChange = False
        textDeleteString.clear()
        textInsertString.clear()
        textOriginalString.clear()

    # Assume the last text block tag in the string is the modified text block
    # text_str = getLastIncompleteTextBlock(diff[1])
    else:
        textDeleteString.append(diff[1])
        textInsertString.append(diff[1])
        textOriginalString.append(diff[1])

    return updateStyleContext


# Based on the current string, iterate through it to find the nested texts and then identify which page we are on
def update_current_page (diff_str):
    global currentPage
    text_items = text_block_regex.findall(diff_str)
    for i in range(len(text_items)):
        get_context_from_str(text_items[i][:-2].split(">")[1])


unmatched_strings = []
def get_context_from_str (text_str):
    global currentPage
    matched = False
    matched_index = -1
    new_text_str = ''.join(unmatched_strings) + text_str
    for k in range(currentPage[0], len(page_context)):
            for j in range(len(page_context[k])):
                page_str = page_context[k][j].encode('ascii', errors='ignore').decode("utf-8")
                index = text_str.find(page_str)
                # print("page_str: ", page_str)
                if page_str and text_str == page_str: #or text_str in page_context[k][j]:
                    currentPage = (k, j)
                    matched = True
                    print("Matched text: ", text_str, " with: ", page_str, " at: ", currentPage)
                    break
                # Edge Case: The text_str is a multiline string that page_str has broken up into multiple parts
                elif page_str and index > matched_index:
                    currentPage = (k, j)
                    matched = True
                    print("Matching multiline string: ", page_str, " at: ", currentPage)
                    matched_index = index
                # Once we have finished matching string and there is no more to match, then we break and move on
                elif matched:
                    break
                # Edge Case 2: 
                elif page_str and new_text_str == page_str:
                    currentPage = (k, j)
                    matched = True
                    print("Matched text: ", new_text_str, " with: ", page_str, " at: ", currentPage)
                    unmatched_strings.clear()
                    break
        
    # If we don't match, skip for now
    if not matched:
        print("ERROR: Unable to match ", text_str)
        unmatched_strings.append(text_str)

def format_diff(diffArr):
    arr = []
    for diff in diffArr:
        if diff[0] == '+':
            arr.append((1, diff[2:]))
        elif diff[0] == '-':
            arr.append((-1, diff[2:]))
        else:
            arr.append((0, diff[2:]))

    return arr

def fetch_updated_diff(context, collabs, prevStr, validDB=False):
    global initialized, changes, prevData, page_context, doc_collabs, currentPage, text_tts_strings
    print('Doc URL: ', doc_url)
    # print('Page Context: ', context)
    try:
        currData =  getURLString(doc_url)
        if initialized:
            currentPage = (0, 0)
            page_context = context
            doc_collabs = collabs

            if validDB:
                prevData = prevStr

            diff = dmp.diff_main(prevData, currData)
            dmp.diff_cleanupSemantic(diff)
            # diff = format_diff(list(d.compare(prevData, currData)))
            changes = getAllChanges(diff)
            prevData = currData

            text_tts_strings.clear()

            get_individual_changes()
            # audio_paths = get_individual_changes()
            get_change_summary()
            # audio_paths.insert(0, get_change_summary())
            return text_tts_strings

        else:
            initialized = True
            prevData = currData
    except:
        # e = sys.exc_info()[0]
        e = traceback.format_exc()
        print(e)
    
    return text_tts_strings

# Initialize the state machine by calling it once
fetch_updated_diff([], {}, "")

# try:
#     while True:
#         currData =  getURLString(doc_url)
#         # diffArr = list(d.compare(prevData, currData))
#         diff = dmp.diff_main(prevData, currData)
#         dmp.diff_cleanupSemantic(diff)
#         newChanges = getAllChanges(diff)
#         prevData = currData
#         time.sleep(sleepTime)
# except KeyboardInterrupt:
#     print('Stopped Python Server. Converting changes to audio...')
#     print("Changes: ", changes)
#     get_change_summary(changes)