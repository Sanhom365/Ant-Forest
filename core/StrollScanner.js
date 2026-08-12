/*
 * @Author: TonyJiangWJ
 * @Date: 2020-09-07 13:06:32
 * @Last Modified by: Sanhom365
 * @Last Modified time: 2026-08-12 15:00:00
 * @Description: 逛一逛收集器 (适配上划巡航与无逛一逛按钮模式)
 */
let { config: _config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let _widgetUtils = singletonRequire('WidgetUtils')
let automator = singletonRequire('Automator')
let _commonFunctions = singletonRequire('CommonFunction')
let fileUtils = singletonRequire('FileUtils')
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let WarningFloaty = singletonRequire('WarningFloaty')
let YoloTrainHelper = singletonRequire('YoloTrainHelper')
let YoloDetection = singletonRequire('YoloDetectionUtil')

let BaseScanner = require('./BaseScanner.js')

const DuplicateChecker = function () {

  this.duplicateChecked = {}

  /**
   * 校验是否全都重复校验过了
   */
  this.checkIsAllDuplicated = function () {
    if (Object.keys(this.duplicateChecked).length === 0) {
      return false
    }
    for (let key in this.duplicateChecked) {
      if (this.duplicateChecked[key].count <= 2) {
        return false
      }
    }
    return true
  }

  /**
   * 记录 白名单、保护罩好友 重复访问次数的数据
   * @param {*} obj 
   */
  this.pushIntoDuplicated = function (obj) {
    let exist = this.duplicateChecked[obj.name]
    if (exist) {
      exist.count++
    } else {
      exist = { name: obj.name, count: 1 }
    }
    this.duplicateChecked[obj.name] = exist
  }

  /**
   * 收集过1个好友后，重置白名单缓存计数
   * 用以确保连续遇到白名单好友才退出逛一逛
   */
  this.resetAll = function () {
    Object.keys(this.duplicateChecked).forEach(key => {
      this.duplicateChecked[key].count = 0
    })
  }

}

const StrollScanner = function () {
  BaseScanner.call(this)
  this.duplicateChecker = new DuplicateChecker()
  this.first_check = true
  this.init = function (option) {
    this.current_time = option.currentTime || 0
    this.increased_energy = option.increasedEnergy || 0
    this.group_execute_mode = option.group_execute_mode || false
    this.createNewThreadPool()
  }

  this.start = function () {
    debugInfo('逛一逛即将开始')
    if (_config.regenerate_stroll_button_every_loop) {
      debugInfo('重新识别逛一逛按钮: ' + regenerateStrollButton())
    }
    return this.collecting()
  }

  this.destroy = function () {
    debugInfo('逛一逛结束')
    this.baseDestroy()
  }

  /**
   * 执行收集操作
   */
  this.collecting = function () {
    let hasNext = true
    let region = null

    // 仅在自己的森林主页寻找“逛一逛”按钮（用于进入第1个好友）
    if (_config.stroll_button_left && !_config.stroll_button_regenerate && !this._regenerate_stroll_button) {
      region = [_config.stroll_button_left, _config.stroll_button_top, _config.stroll_button_width, _config.stroll_button_height]
    } else {
      let successful = regenerateStrollButton()
      if (!successful) {
        warnInfo('自动识别逛一逛按钮失败，请主动配置区域或者图片信息', true)
        hasNext = false
      } else {
        region = [_config.stroll_button_left, _config.stroll_button_top, _config.stroll_button_width, _config.stroll_button_height]
      }
    }  

    let firstEntry = true // 标记是否为第一次进入好友森林  

    while (hasNext) {
      if (this.duplicateChecker.checkIsAllDuplicated()) {
        debugInfo('全部都在白名单，没有可以逛一逛的了')
        break
      }  

      if (firstEntry) {
        // ====== 首次从自己首页进入第一个好友：点击“逛一逛”按钮 ======
        debugInfo(['逛第一个好友，点击逛一逛区域: [{}]', JSON.stringify(region)])
        this.visualHelper.addRectangle('准备点击第一个', region)
        WarningFloaty.addRectangle('逛一逛按钮区域', region, '#00ff00')
        this.visualHelper.displayAndClearAll()
        
        automator.click(region[0] + region[2] / 2, region[1] + region[3] / 2)
        sleep(500) // 增加进入第一个好友页面的等待缓冲
        WarningFloaty.clearAll()
        firstEntry = false 
      } else {
        // ====== 后续好友切换：直接向上滑动屏幕 ======
        debugInfo('切换到下一个好友，执行上划屏幕')
        let screenWidth = _config.device_width || device.width
        let screenHeight = _config.device_height || device.height
        
        // 从屏幕 40% 高度处向上划到 20% 高度，模拟人手流畅滑动
        let startX = Math.floor(screenWidth * 0.5)
        let startY = Math.floor(screenHeight * 0.4)
        let endX = Math.floor(screenWidth * 0.5)
        let endY = Math.floor(screenHeight * 0.2)
        
        swipe(startX, startY, endX, endY, 300)
        sleep(500) // 留出足够的 0.5 秒动画滑动和加载时间
      }

      // 执行当前好友的能量收集
      hasNext = this.collectTargetFriend()
    }  

    WarningFloaty.clearAll()
    let result = { regenerate_stroll_button: this._regenerate_stroll_button }
    Object.assign(result, this.getCollectResult())
    return result
  }

  this.backToListIfNeeded = function (rentery, obj, temp) {
    if (!rentery) {
      debugInfo('准备逛下一个，等待100ms')
      sleep(100)
      return true
    } else {
      debugInfo('二次校验好友信息，等待100ms')
      sleep(100)
      obj.recheck = true
      return this.doCollectTargetFriend(obj, temp)
    }
  }

  this.doIfProtected = function (obj) {
    //
  }

  /**
   * 获取当前好友名称
   */
  this.getFriendName = function () {
    let friendNameGettingRegex = _config.friend_name_getting_regex || '(.*)的蚂蚁森林'
    let titleContainer = _widgetUtils.alternativeWidget(friendNameGettingRegex, _config.stroll_end_ui_content || /找能量共获得.*/, null, true, null, { algorithm: 'PVDFS' })
    if (titleContainer.value === 1) {
      let regex = new RegExp(friendNameGettingRegex)
      if (titleContainer && regex.test(titleContainer.content)) {
        return regex.exec(titleContainer.content)[1]
      } else {
        errorInfo(['获取好友名称失败，请检查好友首页文本"{}"是否存在', friendNameGettingRegex])
      }
    }
    debugInfo(['未找到{} {}', friendNameGettingRegex, titleContainer.value === 2 ? '找到了逛一逛结束标志' : ''])
    return false
  }
}

StrollScanner.prototype = Object.create(BaseScanner.prototype)
StrollScanner.prototype.constructor = StrollScanner

StrollScanner.prototype.collectTargetFriend = function () {
  let obj = {}
  debugInfo('等待进入/校验好友主页')
  let count = 1
  let alternativeFriendOrDone = 0

  if (auto.clearCache) {
    auto.clearCache()
  }

  if (_config.friend_home_check_regex.indexOf('的蚂蚁森林') < 0) {
    _config.overwrite('friend_home_check_regex', _config.friend_home_check_regex + '|.*的蚂蚁森林')
  }

  // 循环等待校验当前页面是否为好友主页
  while ((alternativeFriendOrDone = _widgetUtils.alternativeWidget(_config.friend_home_check_regex, _config.stroll_end_ui_content || /找能量共获得.*/, null, false, null, { algorithm: 'PVDFS' })) !== 1) {
    
    // 如果检测到了“逛一逛结束/找能量共获得...”标志
    if (alternativeFriendOrDone === 2) {
      debugInfo('检测到逛一逛结束标志，终止巡航')
      this.checkDailyReward()
      return false
    }

    if (this.checkAndCollectRain()) {
      return false
    }

    debugInfo('未能进入/识别好友主页，等待500ms count:' + count++)
    sleep(500)

    // 允许重试 4 次，如果依然没有找到好友主页，屏蔽原先“重新识别逛一逛”逻辑，直接返回 true 继续尝试上划下一个
    if (count > 4) {
      warnInfo('无法确认好友主页文本，尝试直接上划跳过该页')
      return true 
    }
  }

  let name = this.getFriendName()
  if (name) {
    obj.name = name
    debugInfo(['进入好友[{}]首页成功', obj.name])
    if (name == this.lastFriendName) {
      this.duplicateEnterCount = (this.duplicateEnterCount ? this.duplicateEnterCount : 0) + 1
    } else {
      this.duplicateEnterCount = 0
    }
    
    // 如果连续 3 次都在同一个好友界面（说明滑动未成功生效）
    if (this.duplicateEnterCount >= 3) {
      warnInfo(['连续卡在好友[{}]界面，滑动可能失效，退出巡航', name], true)
      return false
    }
    this.lastFriendName = name
  } else {
    this.checkAndCollectRain()
    // 拿不到名字但也没有退出标志，返回 true 尝试划到下一个
    return true 
  }

  let skip = false
  if (!skip && _config.white_list && _config.white_list.indexOf(obj.name) >= 0) {
    debugInfo(['{} 在白名单中，不收取他', obj.name])
    skip = true
  }
  if (!skip && _commonFunctions.checkIsProtected(obj.name)) {
    warnInfo(['{} 使用了保护罩，不收取他', obj.name])
    skip = true
  }

  if (skip) {
    return true // 跳过当前好友，允许继续滑动到下一个
  }

  if (!obj.recheck) {
    sleep(100)
    this.protectInfoDetect(obj.name)
  } else {
    this.isProtected = false
    this.isProtectDetectDone = true
  }

  if (this.first_check) {
    _widgetUtils.checkAndUseDuplicateCard()
    this.first_check = false
  }

  // ===== 核心：执行当前好友的能量收集 =====
  let result = this.doCollectTargetFriend(obj)

  if (!this.collect_any) {
    this.duplicateChecker.pushIntoDuplicated(obj)
  } else {
    this.duplicateChecker.resetAll()
  }

  return result
}

StrollScanner.prototype.checkDailyReward = function () {
  if (_commonFunctions.checkStrollRewardCollected()) {
    return
  }
  if (localOcrUtil.enabled) {
    let screen = _commonFunctions.checkCaptureScreenPermission()
    if (!screen) {
      errorInfo(['获取截图失败 无法校验每日奖励'])
      return
    }
    let collectPoint = null, collect = null
    let rewardBtn = localOcrUtil.recognizeWithBounds(screen, null, '领取')
    if (rewardBtn && rewardBtn.length > 0) {
      collect = rewardBtn[0].bounds
      debugInfo('OCR找到了 奖励')
    }
    if (collect) {
      collectPoint = {
        centerX: collect.centerX(),
        centerY: collect.centerY()
      }
    }

    if (collectPoint) {
      automator.click(collectPoint.centerX, collectPoint.centerY)
      _commonFunctions.setStrollRewardCollected()
    }
  }
}

StrollScanner.prototype.checkAndCollectRain = function () {
  let target = null
  auto.clearCache && auto.clearCache()
  if ((target = _widgetUtils.widgetGetOne(_config.rain_entry_content || '.*能量雨.*', 500, true)) != null) {
    if (_widgetUtils.widgetCheck(_config.home_ui_content, 500)) {
      warnInfo('找到能量雨开始标志，但是当前依旧在个人首页')
      return false
    }
    if (!_config.collect_rain_when_stroll) {
      debugInfo('找到能量雨开始标志，但是不需要执行能量雨')
      return true
    }
    if (/已完成/.test(target.content)) {
      debugInfo('今日能量雨已完成')
      return true
    }
    sleep(1000)
    debugInfo('找到能量雨开始标志，准备自动执行能量雨脚本')
    if (/去(收取|拯救)/.test(target.content)) {
      WarningFloaty.clearAll()
      automator.clickCenter(target.target)
      sleep(1000)
      let source = fileUtils.getCurrentWorkPath() + '/unit/能量雨收集.js'
      runningQueueDispatcher.doAddRunningTask({ source: source })
      engines.execScriptFile(source, { path: source.substring(0, source.lastIndexOf('/')), arguments: { executeByStroll: true, executorSource: engines.myEngine().getSource() + '' } })
      _commonFunctions.commonDelay(2.5, '执行能量雨[', true, true)
      automator.back()
    } else {
      debugInfo('未找到去收取，执行能量雨脚本失败')
    }
    this.showCollectSummaryFloaty()
    return true
  }
  return false
}

StrollScanner.prototype.saveButtonRegionIfNeeded = function () {
  if (_config.stroll_button_regenerate) {
    _config.overwrite('stroll_button_left', _config.stroll_button_left)
    _config.overwrite('stroll_button_top', _config.stroll_button_top)
    _config.overwrite('stroll_button_width', _config.stroll_button_width)
    _config.overwrite('stroll_button_height', _config.stroll_button_height)
    _config.overwrite('stroll_button_regenerate', false)
    debugInfo(['保存重新生成的逛一逛按钮区域：{}', JSON.stringify([_config.stroll_button_left, _config.stroll_button_top, _config.stroll_button_width, _config.stroll_button_height])])
  }
}

module.exports = StrollScanner

// inner functions
function refillStrollInfo (region) {
  _config.stroll_button_left = parseInt(region[0])
  _config.stroll_button_top = parseInt(region[1])
  _config.stroll_button_width = parseInt(region[2])
  _config.stroll_button_height = parseInt(region[3])
  _config.stroll_button_regenerate = true
  debugInfo(['重新生成逛一逛按钮区域：{}', JSON.stringify(region)])
}

function ocrFindText (screen, text, tryTime) {
  tryTime = tryTime || 0
  let ocrCheck = localOcrUtil.recognizeWithBounds(screen, null, text)
  if (ocrCheck && ocrCheck.length > 0) {
    return ocrCheck[0]
  } else {
    if (--tryTime > 0) {
      sleep(500)
      return ocrFindText(screen, text, tryTime)
    }
    return null
  }
}

function regenerateByYolo (screen) {
  let yoloCheck = YoloDetection.forward(screen, { labelRegex: 'stroll_btn' })
  if (yoloCheck && yoloCheck.length > 0) {
    let bounds = yoloCheck[0]
    region = [ bounds.x, bounds.y, bounds.width, bounds.height ]
    refillStrollInfo(region)
    return true
  }
  return false
}

function regenerateByOcr (screen) {
  let ocrCheck = ocrFindText(screen, '找能量', 1)
  if (ocrCheck) {
    let bounds = ocrCheck.bounds
    if (!bounds) return false
    region = [ bounds.left, bounds.top, bounds.width(), bounds.height() ]
    refillStrollInfo(region)
    return true
  }
  return false
}

function regenerateByImg (screen) {
  let configImageFail = false
  let imagePoint = OpenCvUtil.findByGrayBase64(screen, _config.image_config.stroll_icon)
  if (!imagePoint) {
    configImageFail = true
    imagePoint = OpenCvUtil.findBySIFTGrayBase64(screen, _config.image_config.stroll_icon)
  }
  if (imagePoint) {
    region = [
      Math.floor(imagePoint.left), Math.floor(imagePoint.top),
      imagePoint.width(), imagePoint.height()
    ]
    if (region[0] + region[2] > _config.device_width) {
      region[2] = _config.device_width - region[0]
    }
    if (region[1] + region[3] > _config.device_height) {
      region[3] = _config.device_height - region[1]
    }
    if (configImageFail) {
      logInfo(['找到目标区域，截图保存：{}', JSON.stringify(region)])
      let croppedImage = images.clip(images.cvtColor(images.grayscale(screen), 'GRAY2BGRA'), region[0], region[1], region[2], region[3])
      _config.overwrite('image_config.stroll_icon', images.toBase64(croppedImage))
    }
    refillStrollInfo(region)
    _commonFunctions.ensureRegionInScreen(region)
    return true
  }
  return false
}

function regenerateStrollButton () {
  if (!_config.image_config.stroll_icon && !localOcrUtil.enabled) {
    warnInfo(['请配置逛一逛按钮图片或者手动指定逛一逛按钮区域'], true)
    return false
  }
  let screen = _commonFunctions.checkCaptureScreenPermission()
  if (!screen) {
    errorInfo(['获取截图失败'])
    return false
  }
  YoloTrainHelper.saveImage(screen, '识别逛一逛按钮')
  let successful = false
  if (YoloDetection.enabled) {
    successful = regenerateByYolo(screen)
  }
  if (!successful && !(successful = regenerateByOcr(screen))) {
    successful = regenerateByImg(screen)
  }
  return successful
}
