const xd = require("scenegraph");

const $ = require("../../utils/utils");
const { AbstractNode } = require("./abstractnode");
const { getOpacity } = require("../../utils/nodeutils");
const { ContextTarget } = require("../context");
const { getImagePath } = require("../image_export");
const NodeUtils = require("../../utils/nodeutils");
const PropType = require("../proptype");

const { Container } = require("./container");
const { Path } = require("./path");

class Shape extends AbstractNode {
	static create(xdNode, ctx) { throw("Shape.create() called."); }

	static fromPath(node, ctx) {
		// creates a Shape from a single path. Used by Copy Selected.
		let shape = new Shape(node.xdNode, ctx);
		shape.add(node);
		return shape;
	}

	// Collection of Path, Container, & Shape nodes that can be 
	// written to a single SVG string. Created by combineShapes.
	constructor(xdNode, ctx) {
		super(xdNode, ctx);
		this.nodes = [];
		this.rejectNextAdd = false;
		this.viewBox = null;
		this._svgString = null;
	}

	get count() {
		return this.nodes.length;
	}

	// get adjustedBounds() {
	// 	console.log(999)
	// 	if (!this.nodes) { return null; }
	// 	// Based on the composite view box, and not concerned with transformations.
	// 	this._calculateViewBox();
	// 	let xdNode = this.xdNode, pb = xdNode.parent.localBounds, vb = this.viewBox;
	// 	return {
	// 		x: vb.x - pb.x,
	// 		y: vb.y - pb.y,
	// 		width: vb.width,
	// 		height: vb.height,
	// 	}
	// }

	get transform() {
		// The SVG string already accounts for the transform.
		return {rotation: 0, flipY: false};
	}

	add(node, aggressive=false) {
		// returns true if the node was added, false if not.
		if (this.rejectNextAdd || !Shape.canAdd(node, aggressive)) {
			this.rejectNextAdd = false;
			return false;
		}
		if (Shape.hasInteraction(node) || node.hasDecorators || node.layout.isResponsive) {
			if (this.nodes.length) { return false; }
			this.decorators = node.decorators;
			this.rejectNextAdd = true;
		}
		// Shapes are added directly to the node list, others are added as xdNodes:
		if (!(node instanceof Shape)) { node = node.xdNode; }
		this.nodes.push(node);
		return true;
	}

	_serialize(ctx) {
		let layout = this.layout;
		// need to recalculate the layout because bounds may have changed due to shape collapsing:
		layout.calculate(ctx);
		
		let svg;
		if (ctx.target === ContextTarget.CLIPBOARD) {
			svg = `'${this.toSvgString(ctx)}'`;
		} else {
			svg = NodeUtils.getShapeDataName(this, ctx);
		}
		if (!layout.isFixedSize) { layout.shouldExpand = true; }
		let fit = !layout.isFixedSize ? "fit: BoxFit.fill, " : "";
		return `SvgPicture.string(${svg}, allowDrawingOutsideViewBox: true, ${fit})`;
	}

	get boundsInParent() {
		this._calculateViewBox();
		return this.xdNode.transform.transformRect(this.viewBox);
	}

	getSvgId(ctx) {
		if (this._svgId) { return this._svgId; }
		this._svgId = $.getHash(this.toSvgString(ctx)).toString(36);
		return this._svgId;
	}

	toSvgString(ctx) {
		if (this._svgString) { return this._svgString; }
		this._calculateViewBox();

		let vx = $.fix(this.viewBox.x);
		let vy = $.fix(this.viewBox.y);
		let vw = $.fix(this.viewBox.width);
		let vh = $.fix(this.viewBox.height);

		let svg = _serializeSvgGroup(this, ctx, true);
		this._svgString = `<svg viewBox="${vx} ${vy} ${vw} ${vh}" >${svg}</svg>`;
		return this._svgString;
	}

	_calculateViewBox() {
		if (this.viewBox) { return; }
		let o = this.viewBox = _calculateAggregateViewBox(this.nodes);
		// ensure a minimum width/height for shapes comprising of just a line:
		o.width = Math.max(1, o.width);
		o.height = Math.max(1, o.height);
	}

}
Shape.canAdd = function(node, aggressive=false) {
	let xdNode = node && node.xdNode;
	return node instanceof Path || node instanceof Shape ||
		(aggressive && node instanceof Container &&
			!(xdNode.fillEnabled && xdNode.fill instanceof xd.ImageFill) &&
			!(xdNode.shadow && xdNode.shadow.visible) &&
			!node.hasDecorators
		);
}
Shape.hasInteraction = function(node) {
	let hasLink = NodeUtils.getInteractionCount(node.xdNode) > 0;
	let hasTap = NodeUtils.getProp(node.xdNode, PropType.TAP_CALLBACK_NAME);
	return !!(hasLink || hasTap);
}

exports.Shape = Shape;

function _serializeSvgGroup(node, ctx, ignoreTransform=false) {
	let result = "";
	for (let i = 0; i < node.nodes.length; ++i) {
		let o = node.nodes[i];
		if (o instanceof Shape) {
			result += _serializeSvgGroup(o, ctx);
		} else {
			result += _serializeSvgNode(o, ctx);
		}
	}
	if (!ignoreTransform) {
		let xform = _getSvgTransform(node.xdNode.transform);
		result = `<g transform="${xform}">${result}</g>`;
	}
	return result;
}

function _serializeSvgNode(xdNode, ctx) {
	// TODO: CE: Pull some of this code out into utility functions
	let o = xdNode, pathStr = o.pathData;
	let opacity = getOpacity(o), fill = "none", fillOpacity = opacity;
	let hasImageFill = false, hasGradientFill = false;
	if (o.fill && o.fillEnabled) {
		hasImageFill = (o.fill instanceof xd.ImageFill);
		hasGradientFill = (o.fill instanceof xd.LinearGradient)
			|| (o.fill instanceof xd.RadialGradient)
		//	|| (o.fill instanceof xd.AngularGradient); // not supported in SVG yet
		if (hasGradientFill) {
			fill = "url(#gradient)";
		} else if (o.fill instanceof xd.Color) {
			fill = "#" + $.getRGBHex(o.fill);
			fillOpacity = (o.fill.a / 255.0) * opacity;
		} else if (o.fill instanceof xd.AngularGradient) {
			ctx.log.warn('Angular gradient fills are not supported on shapes.', o);
		} else if (hasImageFill) {
			// TODO: Flutter SVG doesn't support image fills yet.
			hasImageFill = false;
			//fill = "url(#image)";
			ctx.log.warn('Image fills are not supported on shapes.', o);
		} else {
			ctx.log.warn(`Unrecognized fill type: ${o.fill.constructor.name}.`, o);
		}
	}
	
	if (o.strokeEnabled && o.strokePosition !== xd.GraphicNode.CENTER_STROKE) {
		ctx.log.warn('Only center strokes are supported on shapes.', o);
	}

	let imagePath = hasImageFill ? getImagePath(o) : "";
	let imageWidth = $.fix(hasImageFill ? o.fill.naturalWidth : 0);
	let imageHeight = $.fix(hasImageFill ? o.fill.naturalHeight : 0);
	let stroke = (o.stroke && o.strokeEnabled) ? "#" + $.getRGBHex(o.stroke) : "none";
	let strokeOpacity = (o.stroke && o.strokeEnabled) ? (o.stroke.a / 255.0) * opacity : opacity;
	let strokeWidth = o.strokeWidth;
	let strokeDash = o.strokeDashArray.length > 0 ? o.strokeDashArray[0] : 0;
	let strokeGap = o.strokeDashArray.length > 1 ? o.strokeDashArray[1] : strokeDash;
	let strokeOffset = o.strokeDashArray.length > 0 ? o.strokeDashOffset : 0;
	let strokeMiterLimit = o.strokeJoins === xd.GraphicNode.STROKE_JOIN_MITER ? o.strokeMiterLimit : 0;
	let strokeCap = o.strokeEndCaps;
	let strokeJoin = o.strokeJoins;
	
	let fillAttrib = `fill="${fill}"`;
	if (fillOpacity != 1.0)
		fillAttrib += ` fill-opacity="${$.fix(fillOpacity, 2)}"`;
	let	strokeAttrib = `stroke="${stroke}" stroke-width="${strokeWidth}"`;

	if (strokeOpacity != 1.0)
		strokeAttrib += ` stroke-opacity="${$.fix(strokeOpacity, 2)}"`;
	if (strokeGap != 0)
		strokeAttrib += ` stroke-dasharray="${strokeDash} ${strokeGap}"`;
	if (strokeOffset != 0)
		strokeAttrib += ` stroke-dashoffset="${strokeOffset}"`;
	if (strokeMiterLimit != 0)
		strokeAttrib += ` stroke-miterlimit="${strokeMiterLimit}"`;
	if (strokeCap != xd.GraphicNode.STROKE_CAP_BUTT)
		strokeAttrib += ` stroke-linecap="${strokeCap}"`;
	if (strokeJoin != xd.GraphicNode.STROKE_JOIN_MITER)
		strokeAttrib += ` stroke-linejoin="${strokeJoin}"`;

	let hasShadow = o.shadow && o.shadow.visible;
	if (hasShadow) {
		// TODO: Flutter SVG doesn't support shadows yet.
		hasShadow = false;
		ctx.log.warn('Shadows are not supported on shapes.', o);
	}
	let filterAttrib = hasShadow ? `filter="url(#shadow)"` : "";

	let defs = "";
	if (hasShadow) {
		defs += `<filter id="shadow"><feDropShadow dx="${o.shadow.x}" dy="${o.shadow.y}" stdDeviation="${o.shadow.blur}"/></filter>`;
	}
	if (hasImageFill) {
		defs += `<pattern id="image" patternUnits="userSpaceOnUse" width="${imageWidth}" height="${imageHeight}"><image xlink:href="${imagePath}" x="0" y="0" width="${imageWidth}" height="${imageHeight}" /></pattern>`;
	}
	if (hasGradientFill) {
		let colorStops = '';
		for (let stop of o.fill.colorStops) {
			const offset = $.fix(stop.stop, 6);
			const color = $.getRGBHex(stop.color);
			const opacity = stop.color.a !== 255 ? `stop-opacity="${$.fix(stop.color.a / 255.0, 2)}"` : "";
			colorStops += `<stop offset="${offset}" stop-color="#${color}" ${opacity}/>`;
		}
		if (o.fill instanceof xd.LinearGradient) {
			const x1 = $.fix(o.fill.startX, 6);
			const y1 = $.fix(o.fill.startY, 6);
			const x2 = $.fix(o.fill.endX, 6);
			const y2 = $.fix(o.fill.endY, 6);
			defs += `<linearGradient id="gradient" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">`;
			defs += colorStops;
			defs += `</linearGradient>`;
		} else if (o.fill instanceof xd.RadialGradient) {
			const inv = o.fill.gradientTransform.invert();
			const start = inv.transformPoint({ x: o.fill.startX, y: o.fill.startY });
			const end = inv.transformPoint({ x: o.fill.endX, y: o.fill.endY });
			const fx = $.fix(start.x, 6);
			const fy = $.fix(start.y, 6);
			const fr = $.fix(o.fill.startR, 6);
			const cx = $.fix(end.x, 6);
			const cy = $.fix(end.y, 6);
			const r = $.fix(o.fill.endR, 6);
			const a = $.fix(o.fill.gradientTransform.a, 6);
			const b = $.fix(o.fill.gradientTransform.b, 6);
			const c = $.fix(o.fill.gradientTransform.c, 6);
			const d = $.fix(o.fill.gradientTransform.d, 6);
			const e = $.fix(o.fill.gradientTransform.e, 6);
			const f = $.fix(o.fill.gradientTransform.f, 6);
			let xform="";
			if (a !== 1.0 || b !== 0.0 || c !== 0.0 || d !== 1.0 || e !== 0.0 || f !== 0.0) {
				xform = `gradientTransform="matrix(${a} ${b} ${c} ${d} ${e} ${f})"`;
			}
			defs += `<radialGradient id="gradient" ${xform} fx="${fx}" fy="${fy}" fr="${fr}" cx="${cx}" cy="${cy}" r="${r}">`;
			defs += colorStops;
			defs += `</radialGradient>`;
		}
	}
	defs = defs ? `<defs>${defs}</defs>` : "";

	o.transform.translate(o.localBounds.x, o.localBounds.y);
	const xform = _getSvgTransform(o.transform);
	let transformAttrib = xform ? `transform="${xform}"` : "";

	let str = `${defs}<path ${transformAttrib} d="${pathStr}" ${fillAttrib} ${strokeAttrib} ${filterAttrib}/>`;
	return str;
}

function _getSvgTransform(transform) {
	let result;

	if (transform.a !== 1.0 || transform.b !== 0.0 || transform.c !== 0.0 || transform.d !== 1.0) {
		// Use full transform
		const a = $.fix(transform.a, 6);
		const b = $.fix(transform.b, 6);
		const c = $.fix(transform.c, 6);
		const d = $.fix(transform.d, 6);
		const e = $.fix(transform.e, 2);
		const f = $.fix(transform.f, 2);
		result = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
	} else if (transform.e !== 0.0 || transform.f !== 0.0) {
		// Use offset transform
		const e = $.fix(transform.e, 2);
		const f = $.fix(transform.f, 2);
		result = `translate(${e}, ${f})`;
	} else {
		result = "";
	}
	return result;
}

function _calculateAggregateViewBox(nodes) {
	let minX = Number.MAX_VALUE;
	let minY = Number.MAX_VALUE;
	let maxX = -Number.MAX_VALUE;
	let maxY = -Number.MAX_VALUE;

	for (let o of nodes) {
		let boundsR = o.boundsInParent.x + o.boundsInParent.width;
		let boundsB = o.boundsInParent.y + o.boundsInParent.height;
		if (o.boundsInParent.x < minX) { minX = o.boundsInParent.x; }
		if (o.boundsInParent.y < minY) { minY = o.boundsInParent.y; }
		if (boundsR > maxX) { maxX = boundsR; }
		if (boundsB > maxY) { maxY = boundsB; }
	}

	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
