/*
 * @Author: TonyJiangWJ
 * @Date: 2020-09-07 13:06:32
 * @Last Modified by: Sanhom365
 * @Last Modified time: 2026-08-13 10:44:00/*
 * @Description: 逛一逛收集器
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
   * 
   * @return { true } if failed
   * @return { minCountdown, lostSomeone } if successful
   */
  this.collecting = function () {
    let hasNext = true
    let region = null
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
    while (hasNext) {
      if (this.duplicateChecker.checkIsAllDuplicated()) {
        debugInfo('全部都在白名单，没有可以逛一逛的了')
        break
      }
      debugInfo(['逛下一个, click random region: [{}]', JSON.stringify(region)])
      this.visualHelper.addRectangle('准备点击下一个', region)
      WarningFloaty.addRectangle('逛一逛按钮区域', region, '#00ff00')
      this.visualHelper.displayAndClearAll()
      // 直接点击中间位置
      automator.click(region[0] + region[2] / 2, region[1] + region[3] / 2)
      sleep(300)
      hasNext = this.collectTargetFriend()
    }
    WarningFloaty.clearAll()
    let result = { regenerate_stroll_button: this._regenerate_stroll_button }
    Object.assign(result, this.getCollectResult())
    return result
  }

  this.backToListIfNeeded = function (rentery, obj, temp) {
    if (!rentery) {
      debugInfo('准备逛下一个，等待200ms')
      sleep(200)
      return true
    } else {
      debugInfo('二次校验好友信息，等待250ms')
      sleep(250)
      obj.recheck = true
      return this.doCollectTargetFriend(obj, temp)
    }
  }

  this.doIfProtected = function (obj) {
    //
  }

  /**
   * 逛一逛模式进行特殊处理
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

/**
 * 极简版好友森林收集逻辑（适用于逛一逛模式）
 */
StrollScanner.prototype.collectTargetFriend = function () {
// 1 & 2. 收集能量与二次兜底（兼容双击卡和网络延迟）
    logInfo("进入好友森林，开始检测能量球")
    _base_scanner.collectEnergy(false) // false 表示非自身森林    
    sleep(500) // 停顿0.5秒    
    logInfo("执行二次检测，防止漏收或双击卡未收全")
    _base_scanner.collectEnergy(false)
    // 4. 判断是否进入了最后的任务界面（逛一逛结束）
    let endSign = _widgetUtils.widgetGetOne(".*找能量共获得.*", 1000);
    if (endSign) {
        logInfo("检测到'找能量共获得'，逛一逛结束")
        // 这里可以结合原脚本逻辑，执行 automator.back() 或返回特定状态码
        return false
    }
    // 3. 切换到下一个好友
    logInfo("尝试切换到下一位好友");
    // 如果确定上划可以切换好友，可以使用 automator 提供的滑动封装
    // 注意：坐标参数需根据你的设备分辨率按需调整
    automator.swipe(
        _config.device_width / 2, 
        _config.device_height * 0.7, 
        _config.device_width / 2, 
        _config.device_height * 0.2, 
        300
    )
    sleep(300) // 给页面加载留出时间
    return true // 告诉外层 this.collecting 还有下一个，继续循环
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
    // 首页也有能量雨标志，需要确认是否还停留在首页
    if (_widgetUtils.widgetCheck(_config.home_ui_content, 500)) {
      warnInfo('找到能量雨开始标志，但是当前依旧在个人首页')
      // 重新生成逛一逛按钮区域
      config._regenerate_stroll_button = true
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
  // 用于执行保存数值
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
    region = [
      bounds.x, bounds.y,
      bounds.width, bounds.height
    ]
    refillStrollInfo(region)
    return true
  }
  return false

}

function regenerateByOcr (screen) {
  let ocrCheck = ocrFindText(screen, '找能量', 1)
  if (ocrCheck) {
    let bounds = ocrCheck.bounds
    if (!bounds) {
      return false
    }
    region = [
      bounds.left, bounds.top,
      bounds.width(), bounds.height()
    ]
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
