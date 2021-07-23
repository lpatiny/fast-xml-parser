const bufferUtils = require('./bufferUtils');
const util = require('./util');
const buildOptions = require('./util').buildOptions;
const xmlNode = require('./xmlNode');

const encoder = new TextEncoder();

const defaultOptions = {
  attributeNamePrefix: '@_',
  attrNodeName: false,
  textNodeName: '#text',
  ignoreAttributes: true,
  ignoreNameSpace: false,
  allowBooleanAttributes: false, //a tag can have attributes without any value
  //ignoreRootElement : false,
  parseNodeValue: true,
  parseAttributeValue: false,
  arrayMode: false,
  trimValues: true, //Trim string values of tag and attributes
  cdataTagName: false,
  cdataPositionChar: '\\c',
  tagValueProcessor: function (a) {
    return a;
  },
  attrValueProcessor: function (a) {
    return a;
  },
  stopNodes: [],
  //decodeStrict: false,
};

exports.defaultOptions = defaultOptions;

const props = [
  'attributeNamePrefix',
  'attrNodeName',
  'textNodeName',
  'ignoreAttributes',
  'ignoreNameSpace',
  'allowBooleanAttributes',
  'parseNodeValue',
  'parseAttributeValue',
  'arrayMode',
  'trimValues',
  'cdataTagName',
  'cdataPositionChar',
  'tagValueProcessor',
  'attrValueProcessor',
  'parseTrueNumberOnly',
  'stopNodes',
];
exports.props = props;

/**
 * Trim -> valueProcessor -> parse value
 * @param {string} tagName
 * @param {string} val
 * @param {object} options
 */
function processTagValue(tagName, val, options) {
  if (val) {
    if (options.trimValues) {
      val = val.arrayTrim();
    }
    val = options.tagValueProcessor(val, tagName);
    val = parseValue(val, options.parseNodeValue, options.parseTrueNumberOnly);
  }

  return val;
}

function resolveNameSpace(tagname, options) {
  if (options.ignoreNameSpace) {
    const tags = tagname.arraySplit(0x3a);
    const prefix = tagname[0] === 0x2f ? '/' : ''; //
    if (tags[0] === [0x78, 0x6d, 0x6c, 0x6e, 0x73]) {
      //xmlns
      return '';
    }
    if (tags.length === 2) {
      tagname = prefix + encoder.decode(tags[1]);
    }
  }
  return tagname;
}

function parseValue(val, shouldParse) {
  if (shouldParse && typeof val === 'object') {
    let parsed;
    if (bufferUtils.arrayTrim(val) === [] || isNaN(val)) {
      parsed =
        val === new Uint8Array([0x74, 0x72, 0x75, 0x65]) //true
          ? true
          : val === new Uint8Array([0x66, 0x61, 0x6c, 0x73, 0x65]) //false
          ? false
          : val;
    } else {
      if (val.indexOf([0x30, 0x78]) !== -1) {
        //0x
        //support hexa decimal
        parsed = bufferUtils.arrayParseInt(val, 16);
      } else if (val.indexOf([0x2e]) !== -1) {
        //.
        parsed = bufferUtils.arrayParseFloat(val);
      } else {
        parsed = bufferUtils.arrayParseInt(val, 10);
      }
    }
    return parsed;
  } else {
    if (util.isExist(val)) {
      return val;
    } else {
      return '';
    }
  }
}

const newLocal = '([^\\s=]+)\\s*(=\\s*([\'"])(.*?)\\3)?';
//TODO: change regex to capture NS
//const attrsRegx = new RegExp("([\\w\\-\\.\\:]+)\\s*=\\s*(['\"])((.|\n)*?)\\2","gm");
const attrsRegx = new RegExp(newLocal, 'g');

function buildAttributesMap(attrStr, options) {
  if (!options.ignoreAttributes && typeof attrStr === 'string') {
    attrStr = attrStr.replace(/\r?\n/g, ' ');
    //attrStr = attrStr || attrStr.trim();

    const matches = util.getAllMatches(attrStr, attrsRegx);
    const len = matches.length; //don't make it inline
    const attrs = {};
    for (let i = 0; i < len; i++) {
      const attrName = resolveNameSpace(matches[i][1], options);
      if (attrName.length) {
        if (matches[i][4] !== undefined) {
          if (options.trimValues) {
            matches[i][4] = matches[i][4].trim();
          }
          matches[i][4] = options.attrValueProcessor(matches[i][4], attrName);
          attrs[options.attributeNamePrefix + attrName] = parseValue(
            matches[i][4],
            options.parseAttributeValue,
            options.parseTrueNumberOnly,
          );
        } else if (options.allowBooleanAttributes) {
          attrs[options.attributeNamePrefix + attrName] = true;
        }
      }
    }
    if (!Object.keys(attrs).length) {
      return;
    }
    if (options.attrNodeName) {
      const attrCollection = {};
      attrCollection[options.attrNodeName] = attrs;
      return attrCollection;
    }
    return attrs;
  }
}

//CALLED BY MAIN
const getTraversalObj = function (xmlData, options) {
  xmlData = xmlData.replace(/\r\n?/g, '\n');
  options = buildOptions(options, defaultOptions, props);
  const xmlObj = new xmlNode('!xml');
  let currentNode = xmlObj;
  let textData = '';

  //function match(xmlData){
  for (let i = 0; i < xmlData.length; i++) {
    const ch = xmlData[i];
    if (ch === '<') {
      // ch === 60 if UTF-8
      if (xmlData[i + 1] === '/') {
        // === 47 if UTF-8
        //Closing Tag
        const closeIndex = findClosingIndex(
          //TODid Adapt to arraybuffer
          xmlData,
          '>',
          i,
          'Closing Tag is not closed.',
        );
        let tagName = util.trimArray(
          new Uint8Array(xmlData.buffer, i + 2, closeIndex - i - 2),
        ); //new arraybuffer

        if (options.ignoreNameSpace) {
          const colonIndex = util.arrayIndexOf(tagName, ':');
          if (colonIndex !== -1) {
            tagName = tagName.substr(colonIndex + 1);
          }
        }

        /* if (currentNode.parent) {
          currentNode.parent.val = util.getValue(currentNode.parent.val) + '' + processTagValue2(tagName, textData , options);
        } */
        if (currentNode) {
          if (currentNode.val) {
            currentNode.val = `${util.getValue(
              currentNode.val,
            )}${processTagValue(tagName, textData, options)}`;
          } else {
            currentNode.val = processTagValue(tagName, textData, options);
          }
        }

        if (
          options.stopNodes.length &&
          options.stopNodes.includes(currentNode.tagname)
        ) {
          currentNode.child = [];
          if (currentNode.attrsMap === undefined) {
            currentNode.attrsMap = {};
          }
          currentNode.val = xmlData.substr(
            currentNode.startIndex + 1,
            i - currentNode.startIndex - 1,
          );
        }
        currentNode = currentNode.parent;
        textData = '';
        i = closeIndex;
      } else if (xmlData[i + 1] === '?') {
        //63
        i = findClosingIndex(xmlData, '?>', i, 'Pi Tag is not closed.');
      } else if (xmlData.substr(i + 1, 3) === '!--') {
        //todo three AND or new arraybuffer
        i = findClosingIndex(xmlData, '-->', i, 'Comment is not closed.');
      } else if (xmlData.substr(i + 1, 2) === '!D') {
        //two AND
        const closeIndex = findClosingIndex(
          //yup implement this
          xmlData,
          '>',
          i,
          'DOCTYPE is not closed.',
        );
        const tagExp = xmlData.substring(i, closeIndex);
        if (tagExp.indexOf('[') >= 0) {
          i = xmlData.indexOf(']>', i) + 1;
        } else {
          i = closeIndex;
        }
      } else if (xmlData.substr(i + 1, 2) === '![') {
        //Two AND
        const closeIndex =
          findClosingIndex(xmlData, ']]>', i, 'CDATA is not closed.') - 2;
        const tagExp = xmlData.substring(i + 9, closeIndex); // new arraybuffer

        //considerations
        //1. CDATA will always have parent node
        //2. A tag with CDATA is not a leaf node so it's value would be string type.
        if (textData) {
          currentNode.val = `${util.getValue(currentNode.val)}${processTagValue(
            currentNode.tagname,
            textData,
            options,
          )}`;
          textData = '';
        }

        if (options.cdataTagName) {
          //add cdata node
          const childNode = new xmlNode(
            options.cdataTagName,
            currentNode,
            tagExp,
          );
          currentNode.addChild(childNode);
          //for backtracking
          currentNode.val =
            util.getValue(currentNode.val) + options.cdataPositionChar;
          //add rest value to parent node
          if (tagExp) {
            childNode.val = tagExp;
          }
        } else {
          currentNode.val = (currentNode.val || '') + (tagExp || '');
        }

        i = closeIndex + 2;
      } else {
        //Opening tag
        const result = closingIndexForOpeningTag(xmlData, i + 1);
        let tagExp = result.data;
        const closeIndex = result.index;
        const separatorIndex = tagExp.indexOf(' ');
        let tagName = tagExp;
        let shouldBuildAttributesMap = true;
        if (separatorIndex !== -1) {
          tagName = tagExp.substr(0, separatorIndex).replace(/\s\s*$/, '');
          tagExp = tagExp.substr(separatorIndex + 1);
        }

        if (options.ignoreNameSpace) {
          const colonIndex = tagName.indexOf(':');
          if (colonIndex !== -1) {
            tagName = tagName.substr(colonIndex + 1);
            shouldBuildAttributesMap =
              tagName !== result.data.substr(colonIndex + 1);
          }
        }

        //save text to parent node
        if (currentNode && textData) {
          if (currentNode.tagname !== '!xml') {
            currentNode.val = `${util.getValue(
              currentNode.val,
            )}${processTagValue(currentNode.tagname, textData, options)}`;
          }
        }

        if (
          tagExp.length > 0 &&
          tagExp.lastIndexOf('/') === tagExp.length - 1
        ) {
          //selfClosing tag

          if (tagName[tagName.length - 1] === '/') {
            //remove trailing '/'
            tagName = tagName.substr(0, tagName.length - 1);
            tagExp = tagName;
          } else {
            tagExp = tagExp.substr(0, tagExp.length - 1);
          }

          const childNode = new xmlNode(tagName, currentNode, '');
          if (tagName !== tagExp) {
            childNode.attrsMap = buildAttributesMap(tagExp, options);
          }
          currentNode.addChild(childNode);
        } else {
          //opening tag

          const childNode = new xmlNode(tagName, currentNode);
          if (
            options.stopNodes.length &&
            options.stopNodes.includes(childNode.tagname)
          ) {
            childNode.startIndex = closeIndex;
          }
          if (tagName !== tagExp && shouldBuildAttributesMap) {
            childNode.attrsMap = buildAttributesMap(tagExp, options);
          }
          currentNode.addChild(childNode);
          currentNode = childNode;
        }
        textData = '';
        i = closeIndex;
      }
    } else {
      textData += xmlData[i];
    }
  }
  return xmlObj;
};

function closingIndexForOpeningTag(data, i) {
  let attrBoundary;
  let tagExp = '';
  for (let index = i; index < data.length; index++) {
    let ch = data[index];
    if (attrBoundary) {
      if (ch === attrBoundary) attrBoundary = 0; //reset
    } else if (ch === 0x22 || ch === 0x27) {
      attrBoundary = ch;
    } else if (ch === 0x3c) {
      return {
        data: tagExp,
        index: index,
      };
    } else if (ch === 0x09) {
      ch = 0x20;
    }
    tagExp += String.fromCharCode(ch);
  }
}

function findClosingIndex(xmlData, str, i, errMsg) {
  const closingIndex = util.arrayIndexOf(xmlData, str, i);
  if (closingIndex === -1) {
    throw new Error(errMsg);
  } else {
    return closingIndex + str.length - 1;
  }
}

exports.getTraversalObj = getTraversalObj;
