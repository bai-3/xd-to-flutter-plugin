/*
Copyright 2020 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it. If you have received this file from a source other than Adobe,
then your use, modification, or distribution of it requires the prior
written permission of Adobe. 
*/

const xd = require("scenegraph");

const NodeUtils = require("../../utils/nodeutils");
const { getScrollView, DartType } = require("../../utils/exportutils");
const { normalizeSpacings, normalizePadding, getGroupContentBounds, hasComplexTransform, mergeBounds, LayoutType } = require("../../utils/layoututils");

const { AbstractNode } = require("./abstractnode");
const PropType = require("../proptype");
const { fix } = require("../../utils/utils");
const { addSizedBox } = require("../../utils/layoututils");
const { ExportMode, DEFAULT_CUSTOM_CODE, REQUIRED_PARAM } = require("../constants");

const AddUtils = require("../../utils/addutils");

class Group extends AbstractNode {
	static create(xdNode, ctx) {
		if (xdNode instanceof xd.Group || xdNode instanceof xd.ScrollableGroup) {
			return new Group(xdNode, ctx);
		}
	}

	constructor(xdNode, ctx) {
		super(xdNode, ctx);
		this.children = [];
		
		let mode = this.mode;
		if (mode === ExportMode.INLINE || mode === ExportMode.METHOD) {
			ctx.addParam(this.addParam("onTap", NodeUtils.getProp(this.xdNode, PropType.TAP_CALLBACK_NAME), DartType.TAP_CB));
		} else if (mode === ExportMode.BUILDER) {
			ctx.addParam(this.addParam("builder", this.buildMethodName, DartType.BUILDER, REQUIRED_PARAM));
		}
	}

	get mode() {
		if (!this._mode) {
			this._mode = NodeUtils.getProp(this.xdNode, PropType.EXPORT_MODE) ||
				ExportMode.INLINE;
		}
		return this._mode;
	}

	get buildMethodName() {
		return NodeUtils.getProp(this.xdNode, PropType.BUILD_METHOD_NAME) ||
			NodeUtils.getDefaultBuildMethodName(this.xdNode);
	}

	get background() {
		let padding = this.xdNode.layout.padding;
		return padding && padding.background;
	}

	serialize(ctx) {
		let nodeStr = this._serialize(ctx);
		if (this.mode === ExportMode.CUSTOM || this.mode === ExportMode.BUILDER) {
			// don't decorate or add layout
			// TODO: what about the Comment decorator?
			return nodeStr;
		}
		nodeStr = this._decorate(nodeStr, ctx);

		if (this.mode === ExportMode.METHOD) {
			// TODO: should we add the decorations inside, or outside of the method? What about layout?
			ctx.addBuildMethod(this.buildMethodName, nodeStr);
			return `${this.buildMethodName}(context)`;
		}
		return nodeStr;
	}

	_normalizeChildren() {
		// removes the background child if appropriate.
		return this.children.slice(!!this.background ? 1 : 0);
	}

	_serialize(ctx) {
		// 标记为导出时
		if(this.xdNode.markedForExport){
			let imgPath = AddUtils.addToGenerate(this.xdNode,ctx)
		
			let h = this.xdNode.localBounds.height;
			let w = this.xdNode.localBounds.width;
			return 'Image( // 导出标记元素:\n' +
				`width: ${fix(w)}${NodeUtils.Wutil()},` +
				`height: ${fix(h)}${NodeUtils.Wutil()},` +
				`image: AssetImage('${imgPath}',),` +
			')';
		}

		// TODO: reconcile decorators with export modes.
		if (this.mode === ExportMode.CUSTOM) {
			return this._getCustomCode(ctx);
		} else if (this.mode === ExportMode.BUILDER) {
			return `${this.buildMethodName}(context)`;
		}

		if (!this.hasChildren) { return ""; }

		let xdNode = this.xdNode, layout = xdNode.layout, str;
		if (xdNode.mask) { ctx.log.warn("Group masks aren't supported.", xdNode); }

		// determine group type:
		if (layout.type == "stack") {
			str = this._serializeFlex(ctx);
		} else {
			let nodes =  this._normalizeChildren()
			if(this.background){
				str = nodes[0] && nodes[0].serialize(ctx);
			}else{
				str = this._getChildStack(this._normalizeChildren(), ctx);
			}
		}

		str = this._addPadding(str, ctx);
		str = this._addBackground(str, ctx);
		str = this._addScrolling(str, ctx);
		return str;
	}

	_getCustomCode(ctx) {
		let str = NodeUtils.getProp(this.xdNode, PropType.CUSTOM_CODE) || DEFAULT_CUSTOM_CODE;
		let match = /<(CHILDREN|THIS)({[^}]*?})?>/.exec(str);
		if (!match) { return str; }

		let i=match.index, l=match[0].length, tag=match[1], repStr=null, settings = {};
		if (match[2]) {
			try { settings = JSON.parse(match[2]); }
			catch (e) { ctx.log.warn(`Unable to parse tag settings in custom code: ${e}`, this.xdNode); }
		}

		if (tag === "CHILDREN") {
			// <CHILDREN{'layout':'size|none'}>
			if (settings.layout === "none") {
				this.children.forEach(o => o.layout.enabled = false);
			} else if (settings.layout === "size") {
				this.children.forEach(o => o.layout.reset(true));
			}
			repStr = this._getChildList(this.children, ctx);
		} else if (tag === "THIS") {
			// <THIS{'decorators':false}>
			// TODO: provide separate options for layout vs other decorators?
			let mode = this._mode;
			this._mode = ExportMode.INLINE;
			repStr = settings.decorators ? this.serialize(ctx) : this._serialize(ctx);
			this._mode = mode;
		}
		return repStr == null ? str : str.slice(0, i) + repStr + str.slice(i+l);
	}

	_serializeFlex(ctx) {
		let xdNode = this.xdNode, layout = xdNode.layout;
		let isVertical = layout.stack.orientation == "vertical";

		let str = (isVertical ? "Column(" : "Row(") +
			"crossAxisAlignment: CrossAxisAlignment.start," +
			"mainAxisAlignment: MainAxisAlignment.start," +
			`children: <Widget>[${this._getFlexChildren(ctx)}], ` +
		")";
		return str;
	}

	_getFlexChildren(ctx) {
		let str = "", space;
		let xdNode = this.xdNode, xdLayout = xdNode.layout;
		let isVertical = xdLayout.stack.orientation === "vertical";
		let spaces = normalizeSpacings(xdLayout.stack.spacings, this.children.length-1).reverse();
		let kids = this._normalizeChildren().reverse();

		// 减掉溢出值
		let hasSub = false
		kids.forEach((node, i) => {
			if (!node) { return; }
			node.layout.shouldFixSize = false; // handled below

			let childStr = node.serialize(ctx);
			let size = isVertical ? node.xdNode.localBounds.height : node.xdNode.localBounds.width;
			
			// 删除不必要 SizedBox
			childStr = childStr.replace(/(^\s*)|(\s*$)/g, "");
			if(!(childStr.indexOf("Image(")==0)){
				childStr = `SizedBox(${isVertical ? 'height' : 'width'}: ${fix(size)}${NodeUtils.Wutil()}, child: ${childStr}, )`;
			}

			if (!childStr) { return; } 
			// 填空白空间
			if (space = spaces[i-1]) {
				if(space<0) space = 0
				if(space>20&&!hasSub) {
					space = fix(space-3)
					hasSub = true
				}
				str += `SizedBox(${isVertical ? 'height' : 'width'}: ${space}${NodeUtils.Wutil()}, ), `;
			}

			str += childStr + ", ";
		});
		return str;
	}

	_addBackground(str, ctx) {
		let bg = this.background, bgNode = this.children[0];
		if (!bg) { return str; }
		bgNode.layout.enabled = false;
		// this is just for the error generation:
		hasComplexTransform(bgNode, "Rotation and flip are not supported for background elements.", ctx);
		bgNode.serialize(ctx)
		
		let decoration = "BoxDecoration("
		// 背景颜色
		if(bgNode.xdNode.fill){
			decoration = decoration+`color: ${AddUtils._getBackgroundColor(ctx,bgNode.xdNode)},`
		}
		// 边框
		if (bgNode.xdNode.strokeEnabled) { 
			decoration = decoration + AddUtils._getBorderParam(ctx,bgNode.xdNode)
		}
		// 圆角
		decoration = decoration+AddUtils._getBorderRadiusParam(ctx,bgNode.xdNode)
		decoration = decoration+")"
		
		let i = str.indexOf("Padding(")
		if(i==0){
			str = str.slice(8)
			return 'Container( // 背景合成元素:\n' +
			`decoration: ${decoration}, ` +
			`${str}`;
		}
		return 'Container( // 背景合成元素:\n' +
			`decoration: ${decoration},` +
			`child: ${str}` +
		')';
		// return 'Stack(children: [\n' +
		// 	'// background:\n' +
		// 	`Positioned.fill(child: ${bgNode.serialize(ctx)}, ), ` +
		// 	`Positioned.fill(child: ${str}, ), ` +
		// '], )';
	}

	_addPadding(str, ctx) {
		let padding = this.xdNode.layout.padding;
		let pad = normalizePadding(padding && padding.values);
		if (!pad) { return str; }
		return 'Padding(' +
			`padding: EdgeInsets.` + (pad.homogenous ?
				`all(${fix(pad.top)})` :
				`fromLTRB(${fix(pad.left)}${NodeUtils.Wutil()}, ${fix(pad.top)}${NodeUtils.Wutil()}, ${fix(pad.right)}${NodeUtils.Wutil()}, ${fix(pad.bottom)}${NodeUtils.Wutil()})`) +
			`, child: ${str}, ` +
		')';
	}

	_addScrolling(str, ctx) {
		let xdNode = this.xdNode, vp = xdNode.viewport;
		if (!(xdNode instanceof xd.ScrollableGroup) || !vp) { return str; }
		str = addSizedBox(str, mergeBounds(this.xdNode.children), ctx);
		return getScrollView(str, this, ctx);
	}

}
exports.Group = Group;
