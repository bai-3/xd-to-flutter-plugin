const xd = require("scenegraph");
const app = require('application');
const { project,_Folder,DefaultPath } = require("../core/project");
const ExportUtils = require("./exportutils");
const NodeUtils = require("./nodeutils");
const PropType = require("../core/proptype");
const { getColor } = require("./exportutils");
const $ = require("./utils");

// 任务列表
let queueName = ""
let queueNames = {}
let queues = [];
let folderHandle = null;

// 执行任务
async function queueStart (name){
  queueName = name.replaceAll(" ","").toLowerCase()
  folderHandle = new _Folder(project.root, PropType.IMAGE_PATH+"/"+queueName, DefaultPath.IMAGE+"/"+queueName);
  queueNames = {}
  queues = []
}

// 执行任务
async function queueDo (){
  console.log("图片数："+queues.length)
  for(let i=0;i<queues.length;i++){
    await queues[i]()
  }
  queues = []
  queueNames = {}
  folderHandle = null
}

// 导出标记的组文件
function addToGenerate(node, ctx) {
  let name = node.name.replaceAll(" ","").replaceAll("-","_")
  if(queueNames[name]){
    name = (name +"_"+node.guid).replaceAll("-","_")
  }
  queueNames[name] = true
  // return new Promise(async (ok,fail)=>{
  queues.push(async()=>{
    let previewFile = await folderHandle.getFile(name+".png", ctx);
    if (!node) { return ''; }
    
    let bounds = node.localBounds;
    let scale = Math.min(20, 200 / bounds.height, 400 / bounds.width) * 3; // for hi-dpi
    await app.createRenditions([{
      node, scale,
      outputFile: previewFile,
      type: app.RenditionType.PNG,
    }]);
  });
  return folderHandle._getRelPath().replace("assets/","")+"/"+ name+".png"
  // })
}

// 背景修改开始
function	_getBackgroundColor(ctx,xdNode) {
  let fill = xdNode.fill, color;
  if (fill instanceof xd.Color) {
      color = fill; 
  } else if (fill) {
    ctx.log.warn("Only solid color backgrounds are supported for artboards.", xdNode);
    let stops = fill.colorStops;
    if (stops && stops.length > 0) { color = stops[0].color; }
  }
  return color ? `${getColor(color)}` : "";
}

function _getBorderParam(ctx,xdNode) {
  if (!xdNode.strokeEnabled) { return ""; }
  if (xdNode.strokePosition !== xd.GraphicNode.INNER_STROKE) {
    ctx.log.warn('Only inner strokes are supported on rectangles & ellipses.', xdNode);
  }
  if (xdNode.strokeJoins !== xd.GraphicNode.STROKE_JOIN_MITER) {
    ctx.log.warn('Only miter stroke joins are supported on rectangles & ellipses.', xdNode);
  }
  let dashes = xdNode.strokeDashArray;
  if (dashes && dashes.length && dashes.reduce((a, b) => a + b)) {
    ctx.log.warn('Dashed lines are not supported on rectangles & ellipses.', xdNode);
  }
  let color = xdNode.stroke && ExportUtils.getColor(xdNode.stroke, NodeUtils.getOpacity(xdNode));
  return color ? `border: Border.all(width: ${$.fix(xdNode.strokeWidth, 2)}, color: ${color}), ` : "";
}

function _getBorderRadiusParam(ctx,xdNode) {
  let radiusStr;
  if (xdNode instanceof xd.Ellipse) {
    radiusStr = _getBorderRadiusForEllipse(ctx);
  } else if (xdNode.hasRoundedCorners) {
    radiusStr = _getBorderRadiusForRectangle(ctx,xdNode);
  }
  return radiusStr ? `borderRadius: ${radiusStr}, ` : "";
}

function _getBorderRadiusForEllipse(ctx) {
  // use a really high number so it works if it is resized.
  // using shape: BoxShape.circle doesn't work with ovals
  return `BorderRadius.all(Radius.elliptical(9999.0, 9999.0))`;
}

function _getBorderRadiusForRectangle(ctx,xdNode) {
  let radii = xdNode.cornerRadii;
  let tl = radii.topLeft, tr = radii.topRight, br = radii.bottomRight, bl = radii.bottomLeft;
  if (tl === tr && tl === br && tl === bl) {
    return `BorderRadius.circular(${$.fix(tl, 2)}${NodeUtils.Wutil()})`;
  } else {
    return 'BorderRadius.only(' +
      _getRadiusParam("topLeft", tl) +
      _getRadiusParam("topRight", tr) +
      _getRadiusParam("bottomRight", br) +
      _getRadiusParam("bottomLeft", bl) +
    ')';
  }
}

function _getRadiusParam(param, value) {
  if (value <= 1) { return ''; }
  return `${param}: Radius.circular(${$.fix(value, 2)}), `;
}
// 背景修改结束

module.exports = {
  queueStart,
	queueDo,
	addToGenerate,
  _getBackgroundColor,
  _getBorderParam,
  _getBorderRadiusParam,
  _getBorderRadiusForEllipse,
  _getBorderRadiusForRectangle,
  _getRadiusParam
};