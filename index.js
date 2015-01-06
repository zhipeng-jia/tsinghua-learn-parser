'use strict';

var request = require('request');
var async = require('async');
var cheerio = require('cheerio');
var queryString = require('query-string');
var _ = require('lodash');
var S = require('string');

var iconv = require('iconv-lite');
iconv.extendNodeEncodings();

/**
 * Login to the learn website
 * @param {string} userName - User name
 * @param {string} password - Password
 * @param {function(err, cookieJar)} callback - The callback function, with parameters err and cookieJar. cookieJar stores cookie used in later requests.
 */
function login(userName, password, callback) {
  var jar = request.jar();
  request.post({
    url: 'https://learn.tsinghua.edu.cn/MultiLanguage/lesson/teacher/loginteacher.jsp',
    form: { userid: userName, userpass: password },
    jar: jar
  }, function (err) {
    if (err) {
      return callback(err);
    }
    callback(null, jar);
  });
}

function parseCourseName(courseId, cookieJar, callback) {
  request.get({
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/public/bbs/getnoteid_student.jsp',
    qs: { course_id: courseId },
    jar: cookieJar
  }, function (err, res, body) {
    if (err) {
      return callback(err);
    }
    var $ = cheerio.load(body);
    callback(null, $('#info_1 .info_title').text().trim());
  });
}

/**
 * Get an object contains IDs and names of all courses
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {function(err, courseIds)} callback - The callback function, with parameters err and courseIds.
 */
function getAllCourses(cookieJar, callback) {
  request.get({
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/lesson/student/MyCourse.jsp',
    jar: cookieJar
  }, function (err, res, body) {
    if (err) {
      return callback(err);
    }
    var $ = cheerio.load(body);
    var courseUrls = $('#info_1 tr a').map(function () {
      return $(this).attr('href');
    }).get();
    var courseIds = _.map(courseUrls, function (elem) {
      var params = elem.substring(elem.lastIndexOf('?'));
      return queryString.parse(params).course_id;
    });
    async.map(courseIds, function (courseId, callback) {
      parseCourseName(courseId, cookieJar, callback);
    }, function (err, results) {
      if (err) {
        return callback(err);
      }
      callback(null, _.zipObject(courseIds, results));
    });
  });
}

function parseCourseNotification(courseId, cookieJar, callback) {
  request.get({
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/public/bbs/getnoteid_student.jsp',
    qs: { course_id: courseId },
    jar: cookieJar
  }, function (err, res, body) {
    if (err) {
      return callback(err);
    }
    var $ = cheerio.load(body);
    var result = $('#table_box').find('tr.tr1, tr.tr2').map(function () {
      var columns = $(this).find('td');
      var url = columns.eq(1).find('a').attr('href');
      var urlParams = url.substring(url.lastIndexOf('?'));
      return {
        id: queryString.parse(urlParams).id,
        title: columns.eq(1).find('a').text().trim(),
        author: columns.eq(2).text(),
        releaseDate: columns.eq(3).text()
      };
    }).get();
    async.each(result, function (entry, callback) {
      request.get({
        url: 'http://learn.tsinghua.edu.cn/MultiLanguage/public/bbs/note_reply.jsp',
        qs: {
          bbs_type: '课程公告',
          id: entry.id,
          course_id: courseId
        },
        jar: cookieJar
      }, function (err, res, body) {
        if (err) {
          return callback(err);
        }
        var $ = cheerio.load(body);
        entry.content = $('#table_box tr').eq(1).find('td').eq(1).text();
        callback(null);
      });
    }, function (err) {
      if (err) {
        return callback(err);
      }
      callback(null, result);
    });
  });
}

function parseCourseHomework(courseId, cookieJar, callback) {
  request.get({
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/lesson/student/hom_wk_brw.jsp',
    qs: { course_id: courseId },
    jar: cookieJar
  }, function (err, res, body) {
    if (err) {
      return callback(err);
    }
    var $ = cheerio.load(body);
    var result = $('#info_1 table').eq(1).find('tr.tr1, tr.tr2').map(function () {
      var columns = $(this).find('td');
      return {
        url: columns.eq(0).find('a').attr('href'),
        title: columns.eq(0).text().trim(),
        releaseDate: columns.eq(1).text(),
        deadline: columns.eq(2).text(),
        submitted: columns.eq(3).text().trim() === '已经提交'
      };
    }).get();
    async.each(result, function (entry, callback) {
      var params = entry.url.substring(entry.url.lastIndexOf('?'));
      entry.id = queryString.parse(params).id;
      request.get({
        url: 'http://learn.tsinghua.edu.cn/MultiLanguage/lesson/student/' + entry.url,
        jar: cookieJar
      }, function (err, res, body) {
        if (err) {
          return callback(err);
        }
        var $ = cheerio.load(body);
        var mainTable = $('#table_box');
        entry.description = mainTable.find('tr').eq(1).find('td').eq(1).find('textarea').val();
        var attachment = mainTable.find('tr').eq(2).find('td').eq(1);
        if (attachment.find('a').length > 0) {
          entry.attachmentUrl = 'http://learn.tsinghua.edu.cn' + attachment.find('a').attr('href');
        }
        delete entry.url;
        callback(null);
      });
    }, function (err) {
      if (err) {
        return callback(err);
      }
      callback(null, result);
    });
  });
}

function parseCourseFile(courseId, cookieJar, callback) {
  request.get({
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/lesson/student/download.jsp',
    qs: { course_id: courseId },
    jar: cookieJar
  }, function (err, res, body) {
    if (err) {
      return callback(err);
    }
    var $ = cheerio.load(body);
    var layerNames = $('.textTD').map(function () {
      return $(this).text();
    }).get();
    var contents = [];
    $('.layerbox').each(function () {
      contents.push($(this).find('table').find('tr.tr1, tr.tr2').map(function () {
        var columns = $(this).find('td');
        return {
          url: 'http://learn.tsinghua.edu.cn' + columns.eq(1).find('a').attr('href'),
          title: columns.eq(1).text().trim(),
          description: columns.eq(2).text(),
          releaseDate: columns.eq(4).text()
        };
      }).get());
    });
    callback(null, _.zipObject(layerNames, contents));
  });
}

/**
 * Parse a course
 * @param {number|string} courseId - The ID of the course
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {function(err, result)} callback - The callback function, with parameters err and result.
 */
function parseCourse(courseId, cookieJar, callback) {
  async.parallel([
    async.apply(parseCourseName, courseId, cookieJar),
    async.apply(parseCourseNotification, courseId, cookieJar),
    async.apply(parseCourseHomework, courseId, cookieJar),
    async.apply(parseCourseFile, courseId, cookieJar)
  ], function (err, result) {
    if (err) {
      return callback(err);
    }
    var course = {};
    course.id = courseId;
    course.name = result[0];
    course.notification = result[1];
    course.homework = result[2];
    course.file = result[3];
    callback(null, course);
  });
}

/**
 * Parse multiple courses
 * @param {array} courseIds - The IDs of the courses
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {function(err, result)} callback - The callback function, with parameters err and result.
 */
function parseCourses(courseIds, cookieJar, callback) {
  async.map(courseIds, function (courseId, callback) {
    parseCourse(courseId, cookieJar, callback);
  }, callback);
}

/**
 * Get save name of a specific attachment
 * @param {string} url - The URL of the attachment
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {string} [curl] - Path to cURL executable (default is 'curl')
 * @param {function(err, result)} callback - The callback function, with parameters err and saveName.
 */
function getSaveName(url, cookieJar, curl, callback) {
  if (_.isUndefined(callback)) {
    callback = curl;
    curl = 'curl';
  }
  var components = require('url').parse(url);
  var cookieString = cookieJar.getCookieString(components.protocol + '//' + components.host);
  var spawn = require('child_process').spawn;
  var child = spawn(curl, ['--cookie', cookieString, '--head', '-i', url], { stdio: [null, 'pipe'] });
  var stream = child.stdout;
  stream.setEncoding('GBK');
  var output = '';
  stream.on('data', function (chunk) {
    output += chunk;
  });
  child.on('exit', function (code) {
    if (code !== 0) {
      return callback(new Error('Request unsucessful.'));
    }
    var contentHeader = _.find(S(output).lines(), function (line) {
      return S(line).startsWith('Content-Disposition: ');
    });
    if (contentHeader === null) {
      callback(new Error('Cannot find Content-Disposition header.'));
    } else {
      callback(null, S(contentHeader).chompLeft('Content-Disposition: attachment;filename="').chompRight('"').s);
    }
  });
}

/**
 * Download a specific attachment
 * @param {string} url - The URL of the attachment
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {function(err, result)} callback - The callback function, with parameters err and fileBody.
 */
function downloadFile(url, cookieJar, callback) {
  request.get({ url: url, jar: cookieJar, encoding: null }, function (err, res, body) {
    if (err) {
      return callback(err);
    }
    callback(null, body);
  });
}

exports.login = login;
exports.getAllCourses = getAllCourses;
exports.parseCourse = parseCourse;
exports.parseCourses = parseCourses;
exports.getSaveName = getSaveName;
exports.downloadFile = downloadFile;
