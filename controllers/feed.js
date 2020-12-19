const fs = require('fs');
const path = require('path');
require('dotenv').config();
const AWS = require('aws-sdk');
AWS.config.update({region: process.env.REGION});
const { validationResult } = require('express-validator/check');

const io = require('../socket');
const Post = require('../models/post');
const User = require('../models/user');
const ID = process.env.AWS_ID;
const SECRET = process.env.AWS_KEY;
const BUCKET_NAME = process.env.BUCKET_NAME;
const s3 = new AWS.S3({
  apiVersion: '2006-03-01',
  accessKeyId: ID,
  secretAccessKey: SECRET
});


exports.getPosts = async (req, res, next) => {
  const currentPage = req.query.page || 1;
  const perPage = 2;
  try {
    const totalItems = await Post.find().countDocuments();
    const posts = await Post.find()
      .populate('creator')
      .sort({ createdAt: -1 })
      .skip((currentPage - 1) * perPage)
      .limit(perPage);

    res.status(200).json({
      message: 'Fetched posts successfully.',
      posts: posts,
      totalItems: totalItems
    });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.createPost = async (req, res, next) => {
  console.log("ENDPOINT HIT");
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error('Validation failed, entered data is incorrect.');
    error.statusCode = 422;
    throw error;
  }
  if (!req.file) {
    const error = new Error('No image provided.');
    error.statusCode = 422;
    throw error;
  }
  const filePath = path.join(__dirname, '..', req.file.path);
  const imgContent = fs.createReadStream(filePath);
  const params = {
    Bucket: BUCKET_NAME,Key: req.body.title, // File name you want to save as in S3
    Body: imgContent
  };
  let postAWS;
  try{
    const posts=await Post.find({'title':req.body.title});
    if(posts.length>0)
    {
      const error=new Error("Title Exits!")
      throw error;
    }
    postAWS=await s3.upload(params).promise();
  }
  catch(err)
  {
    throw err;
  }
  //console.log(postAWS);
  const title = req.body.title;
  const content = req.body.content;
  const imageUrl = postAWS.Location;
  const post = new Post({
    title: title,
    content: content,
    imageUrl: imageUrl,
    creator: req.userId
  });
  try {
    await post.save();
    const user = await User.findById(req.userId);
    user.posts.push(post);
    await user.save();
    io.getIO().emit('posts', {
      action: 'create',
      post: { ...post._doc, creator: { _id: req.userId, name: user.name } }
    });
    clearImage(req.file.path);
    res.status(201).json({
      message: 'Post created successfully!',
      post: post,
      creator: { _id: user._id, name: user.name }
    });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.getPost = async (req, res, next) => {
  const postId = req.params.postId;
  const post = await Post.findById(postId);
  try {
    if (!post) {
      const error = new Error('Could not find post.');
      error.statusCode = 404;
      throw error;
    }
    const creator=await User.findById(post.creator);
    // console.log(post);
    res.status(200).json({ message: 'Post fetched.', post: post,author:creator.name});
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.updatePost = async (req, res, next) => {
  const postId = req.params.postId;
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = new Error('Validation failed, entered data is incorrect.');
    error.statusCode = 422;
    throw error;
  }
  const title = req.body.title;
  const content = req.body.content;
  let imageUrl = req.body.image;
  try {
    const post = await Post.findById(postId).populate('creator');
    if (!post) {
      const error = new Error('Could not find post.');
      error.statusCode = 404;
      throw error;
    }
    if (post.creator._id.toString() !== req.userId) {
      const error = new Error('Not authorized!');
      error.statusCode = 403;
      throw error;
    }
    if (req.file) 
    {
      //Deleting previous s3 bucket image

      try{
        const exist = await s3.headObject({Bucket:BUCKET_NAME,Key: post.title}).promise().then(()=>true,err=>{
          if(err.code==='NotFound'){return false;}throw err;
        });
        if(exist)
        {const del=await s3.deleteObject({   Bucket: BUCKET_NAME,Key: post.title }).promise();}
      }
      catch(err){throw err;}

      //uploading latest s3 bucket image
      const filePath = path.join(__dirname, '..', req.file.path);
      const imgContent = fs.createReadStream(filePath);
      const params = {
      Bucket: BUCKET_NAME,Key: req.body.title, // File name you want to save as in S3
      Body: imgContent
      };
      let postAWS;
      try{
      const posts=await Post.find({'title':req.body.title});
      if(posts.length>1)
      {
        const error=new Error("Title Exits!")
        throw error;
      }
      postAWS=await s3.upload(params).promise();
      }
      catch(err)
      {
        throw err;
      }
      imageUrl = postAWS.Location;
      clearImage(req.file.path);
    }
    if (!imageUrl) {
      const error = new Error('No file picked.');
      error.statusCode = 422;
      throw error;
    }    
    // console.log(imageUrl);
    post.title = title;
    post.imageUrl = imageUrl;
    post.content = content;
    const result = await post.save();
    io.getIO().emit('posts', { action: 'update', post: result });
    res.status(200).json({ message: 'Post updated!', post: result });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

exports.deletePost = async (req, res, next) => {
  const postId = req.params.postId;
  try {
    const post = await Post.findById(postId);

    if (!post) {
      const error = new Error('Could not find post.');
      error.statusCode = 404;
      throw error;
    }
    if (post.creator.toString() !== req.userId) {
      const error = new Error('Not authorized!');
      error.statusCode = 403;
      throw error;
    }
    // Check logged in user
    const params = {   Bucket: BUCKET_NAME,Key: post.title };
    try{
    const del=await s3.deleteObject(params).promise(); 
    }
    catch(err)
    {
      throw err;
    } 
    await Post.findByIdAndRemove(postId);

    const user = await User.findById(req.userId);
    user.posts.pull(postId);
    await user.save();
    io.getIO().emit('posts', { action: 'delete', post: postId });
    res.status(200).json({ message: 'Deleted post.' });
  } catch (err) {
    if (!err.statusCode) {
      err.statusCode = 500;
    }
    next(err);
  }
};

const clearImage = filePath => {
  filePath = path.join(__dirname, '..', filePath);
  fs.unlink(filePath, err => console.log(err));
};
