/*
Copyright 2020 Adobe
All Rights Reserved.

NOTICE: Adobe permits you to use, modify, and distribute this file in
accordance with the terms of the Adobe license agreement accompanying
it. If you have received this file from a source other than Adobe,
then your use, modification, or distribution of it requires the prior
written permission of Adobe. 
*/

const $ = require("../../utils/utils");
const { AbstractDecorator } = require("./abstractdecorator");
const nodetype = require("../nodetype");

class Comment extends AbstractDecorator {
	static create(node, ctx) {
		if (Comment.enabled && !node.xdNode.hasDefaultName) {
			return new Comment(node, ctx, true);
		}
	}

	_serialize(nodeStr, ctx) {
		let xdNode = this.node.xdNode;
		let name = $.shorten(xdNode.name, 20), type = nodetype.getXDLabel(xdNode);
		let i = nodeStr.indexOf("(")
		let nodeStrStart = nodeStr.slice(0, i + 1)
		let nodeStrStop = nodeStr.slice(i + 1)
		return `\n${nodeStrStart}\n // 设计图图层名: '${name}' (${type})\n ${nodeStrStop}`;
	}
}
Comment.enabled = true;

exports.Comment = Comment;