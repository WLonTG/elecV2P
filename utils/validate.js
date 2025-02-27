/**
 * 前端 UI 网络请求合法性检测
 */

const cookie = require('cookie')
const { parse } = require('url')
const { CONFIG } = require('../config')

const { logger } = require('./logger')
const clog = new logger({ head: 'access', level: 'debug', file: 'access.log' })
const { atob, btoa, iRandom } = require('./string')
const { now } = require('./time')

const validate_status = {
  total: 0,                // 总访问次数
  black: new Map(),        // 非法访问详情
  blacknum: 0,             // 当前非法访问次数
  cookieset: new Set(),    // 已 cookie 授权的客户端（仅记录本次运行
}

// 检测某个网络请求是否合法
function isAuthReq(req, res) {
  let ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress
  if (ipAddress.startsWith('::ffff:')) {
    ipAddress = ipAddress.substr(7)
  }
  validate_status.total++;
  let headstr = `${ipAddress} ${req.method} ${req.originalUrl || '/'},`
  switch (req.path) {
  case '/favicon.ico':
    clog.debug(headstr, 'no need to validate check');
    return true;
  }
  if (!CONFIG.SECURITY || CONFIG.SECURITY.enable === false) {
    clog.debug(headstr, 'config security is not enable');
    return true;
  }
  if (CONFIG.SECURITY.webhook_only) {
    if (req.path !=='/webhook') {
      clog.error(headstr, 'rejected by elecV2P because of webhook only');
      return false;
    }
  }
  let cookies = cookie.parse(req.headers.cookie || '')
  if (cookies?.token?.length > 10 && (CONFIG.wbrtoken + CONFIG.wbrtoken).indexOf(atob(cookies.token)) !== -1) {
    clog.debug(headstr, 'authorized by cookie')
    return true
  }
  if (CONFIG.wbrtoken) {
    if (!req.query) {
      req.query = parse(req.url, true).query
    }
    let token = req.query?.token || req.body?.token
    if (token) {
      clog.debug(headstr, 'get token from request query/body');
    } else {
      if (req.headers['authorization']) {
        token = req.headers['authorization'].split(' ')[1]
        clog.debug(headstr, 'get token from request headers authorization')
      } else if (req.headers['referer']) {
        token = parse(req.headers['referer'], true).query?.token
        if (token) {
          clog.debug(headstr, 'get token from request headers referer')
        }
      }
    }
    if (token === CONFIG.wbrtoken) {
      clog.debug(headstr, 'authorized by token')
      if (res && req.path !=='/webhook') {
        let days = req.query?.cookie === 'long' ? 365 : 7
        clog.notify('set cookie for', ipAddress, 'Max-Age:', days, 'days')
        res.setHeader('Set-Cookie', cookie.serialize('token', btoa((CONFIG.wbrtoken + CONFIG.wbrtoken ).substr(iRandom(CONFIG.wbrtoken.length), 10)), {
          httpOnly: true,
          maxAge: 60 * 60 * 24 * days // cookie 有效期
        }))
        require('./feed').feedPush('Set cookie for ' + ipAddress, `Time: ${now()}\nMax-Age: ${days} days\nUser-Agent: ${req.headers['user-agent']}\nIf this wasn't you, please consider changing your WEBHOOK TOKEN`)
        validate_status.cookieset.add({
          ip: ipAddress,
          ua: req.headers['user-agent'],
          time: now(),
          path: req.pah,
          days: days,
        })
      }
      return true
    }
  }
  let blacklist = CONFIG.SECURITY.blacklist || []
  let whitelist = CONFIG.SECURITY.whitelist || []

  if (whitelist.indexOf(ipAddress) !== -1 || (blacklist.indexOf('*') === -1 && blacklist.indexOf(ipAddress) === -1)) {
    clog.debug(headstr, 'authorized by IP')
    return true
  } else {
    clog.notify(headstr, 'rejected by elecV2P because of unauthorized');
    validate_status.blacknum++;
    validate_status.black.set(ipAddress, (validate_status.black.get(ipAddress) || 0) + 1);
    if (CONFIG.SECURITY.numtofeed > 0 && validate_status.blacknum % CONFIG.SECURITY.numtofeed === 0) {
      let feedbody = '';
      validate_status.black.forEach((count, ip)=>{
        feedbody += ip + ' try ' + count + ' times\n';
      });
      let acclog = (CONFIG.homepage || '.') + '/logs/access.log';
      feedbody += '\n' + 'access.log ' + acclog;
      require('./feed').feedPush(ipAddress + ' try to access elecV2P', feedbody, acclog);
    }
    return false
  }
}

module.exports = { isAuthReq, validate_status }