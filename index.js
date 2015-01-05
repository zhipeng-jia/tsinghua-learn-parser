
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

/**
 * Get IDs of all courses using specific cookie
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {function(err, courseIds)} callback - The callback function, with parameters err and courseIds.
 */
function getCourseIds(cookieJar, callback) {
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
      return queryString.parse(params)['course_id'];
    });
    callback(null, courseIds);
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
    var mainTable = $('#table_box');
    var result = [];
    mainTable.find('tr').each(function () {
      if ($(this).hasClass('tr1') || $(this).hasClass('tr2')) {
        var columns = $(this).find('td');
        var url = columns.eq(1).find('a').attr('href');
        var urlParams = url.substring(url.lastIndexOf('?'));
        result.push({
          id: queryString.parse(urlParams)['id'],
          title: columns.eq(1).find('a').text().trim(),
          author: columns.eq(2).text(),
          releaseDate: columns.eq(3).text()
        });
      }
    });
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
    var mainTable = $('#info_1 table').eq(1);
    var result = [];
    mainTable.find('tr').each(function () {
      if ($(this).hasClass('tr1') || $(this).hasClass('tr2')) {
        var columns = $(this).find('td');
        result.push({
          url: columns.eq(0).find('a').attr('href'),
          title: columns.eq(0).text().trim(),
          releaseDate: columns.eq(1).text(),
          deadline: columns.eq(2).text(),
          submitted: columns.eq(3).text().trim() === '已经提交'
        });
      }
    });
    async.each(result, function (entry, callback) {
      var params = entry.url.substring(entry.url.lastIndexOf('?'));
      entry.id = queryString.parse(params)['id'];
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
    var result = {};
    $('.layerbox').each(function (index) {
      var files = [];
      $(this).find('table tr').each(function () {
        if ($(this).hasClass('tr1') || $(this).hasClass('tr2')) {
          var columns = $(this).find('td');
          files.push({
            url: 'http://learn.tsinghua.edu.cn' + columns.eq(1).find('a').attr('href'),
            title: columns.eq(1).text().trim(),
            description: columns.eq(2).text(),
            releaseDate: columns.eq(4).text()
          });
        }
      });
      result[layerNames[index]] = files;
    });
    callback(null, result);
  });
}

/**
 * Parse a course using specific cookie
 * @param {number} courseId - The ID of the course
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {function(err, result)} callback - The callback function, with parameters err and result.
 */
function parseCourse(courseId, cookieJar, callback) {
  async.parallel([
    function (callback) {
      parseCourseName(courseId, cookieJar, callback);
    },
    function (callback) {
      parseCourseNotification(courseId, cookieJar, callback);
    },
    function (callback) {
      parseCourseHomework(courseId, cookieJar, callback);
    },
    function (callback) {
      parseCourseFile(courseId, cookieJar, callback);
    }
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
 * Parse multiple courses using specific cookie
 * @param {number} courseIds - The IDs of the courses
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {function(err, result)} callback - The callback function, with parameters err and result.
 */
function parseCourses(courseIds, cookieJar, callback) {
  async.map(courseIds, function (courseId, callback) {
    parseCourse(courseId, cookieJar, callback);
  }, callback);
}

function getSaveName(url, cookieJar, callback) {
  var components = require('url').parse(url);
  var cookieString = cookieJar.getCookieString(components.protocol + '//' + components.host);
  var spawn = require('child_process').spawn;
  var child = spawn('curl', ['--cookie', cookieString, '--head', '-i', url], { stdio: [null, 'pipe'] });
  var stream = child.stdout;
  stream.setEncoding('GBK');
  var output = '';
  stream.on('data', function (chunk) {
    output += chunk;
  });
  child.on('exit', function () {
    var lines = S(output).lines();
    var saveName = null;
    _.each(lines, function (line) {
      if (S(line).startsWith('Content-Disposition: ')) {
        saveName = S(line).chompLeft('Content-Disposition: attachment;filename="').chompRight('"').s;
      }
    });
    if (saveName == null) {
      callback(new Error());
    } else {
      callback(null, saveName);
    }
  });
}

/**
 * Download a specific attachment
 * @param {string} url - The URL of the attachment
 * @param {object} cookieJar - Cookie object returned by {@link login} function
 * @param {function(err, result)} callback - The callback function, with parameters err, saveName and fileBody.
 */
function downloadFile(url, cookieJar, callback) {
  getSaveName(url, cookieJar, function (err, saveName) {
    console.log(saveName);
    if (err) {
      return callback(err);
    }
    request.get({ url: url, jar: cookieJar, encoding: null }, function (err, res, body) {
      if (err) {
        return callback(err);
      }
      callback(null, saveName, body);
    });
  });
}

exports.login = login;
exports.getCourseIds = getCourseIds;
exports.parseCourse = parseCourse;
exports.parseCourses = parseCourses;
exports.downloadFile = downloadFile;
