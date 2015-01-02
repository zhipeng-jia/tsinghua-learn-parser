
var request = require('request');
var async = require('async');
var cheerio = require('cheerio');
var queryString = require('query-string');
var trim = require('trim');
var _ = require('lodash');

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
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/public/bbs/getnoteid_student.jsp' + '?' + queryString.stringify({ course_id: courseId }),
    jar: cookieJar
  }, function (err, res, body) {
    if (err) {
      return callback(err);
    }
    var $ = cheerio.load(body);
    callback(null, trim($('#info_1 .info_title').text()));
  });
}

function parseCourseNotification(courseId, cookieJar, callback) {
  request.get({
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/public/bbs/getnoteid_student.jsp' + '?' + queryString.stringify({ course_id: courseId }),
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
          title: trim(columns.eq(1).find('a').text()),
          author: columns.eq(2).text(),
          releaseDate: columns.eq(3).text()
        });
      }
    });
    async.each(result, function (entry, callback) {
      var params = {
        bbs_type: '课程公告',
        id: entry.id,
        course_id: courseId
      };
      request.get({
        url: 'http://learn.tsinghua.edu.cn/MultiLanguage/public/bbs/note_reply.jsp' + '?' + queryString.stringify(params),
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
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/lesson/student/hom_wk_brw.jsp' + '?' + queryString.stringify({ course_id: courseId }),
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
          title: trim(columns.eq(0).text()),
          releaseDate: columns.eq(1).text(),
          deadline: columns.eq(2).text(),
          submitted: trim(columns.eq(3).text()) === '已经提交'
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
    })
  });
}

function parseCourseFile(courseId, cookieJar, callback) {
  request.get({
    url: 'http://learn.tsinghua.edu.cn/MultiLanguage/lesson/student/download.jsp' + '?' + queryString.stringify({ course_id: courseId }),
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
            title: trim(columns.eq(1).text()),
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

function parseCourses(courseIds, cookieJar, callback) {
  async.map(courseId, function (courseId, callback) {
    parseCourse(courseId, cookieJar, callback);
  }, callback);
}

exports.login = login;
exports.getCourseIds = getCourseIds;
exports.parseCourse = parseCourse;
exports.parseCourses = parseCourses;
