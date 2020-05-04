const path=require('path');
const https=require('https');
const MONGODB_URI='mongodb+srv://uditsingh294:5511@restapp-raulb.mongodb.net/test?retryWrites=true&w=majority';

const fs=require('fs');
const express=require('express');
const app=express();
const bodyParser=require('body-parser');
const mongoose=require('mongoose');
const feedRoutes=require('./routes/feed');
const authRoutes=require('./routes/auth');
const multer=require('multer');
const helmet=require('helmet');
const compression=require('compression');
const morgan=require('morgan');


const fileStorage=multer.diskStorage({
     destination:(req,file,cb)=>{
          cb(null,'images');
     },
     filename:(req,file,cb)=>{
          cb(null,new Date().toISOString()+'-'+file.originalname);
     }
});

const fileFilter=(req,file,cb)=>{
     if(file.mimetype==='image/png' || file.mimetype === 'image/jpg' || file.mimetype ==='image/jpeg')
     {
          cb(null,true);
     }else{
          cb(null,false);
     }
}
const accessLogStream=fs.createWriteStream(path.join(__dirname,'access.log'),{flags:'a'});

app.use(helmet());
app.use(compression());
app.use(morgan('combined',{stream:accessLogStream}));

app.use(bodyParser.json()); // application/json
app.use(
  multer({ storage: fileStorage, fileFilter: fileFilter }).single('image')
);
app.use('/images', express.static(path.join(__dirname, 'images')));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'OPTIONS, GET, POST, PUT, PATCH, DELETE'
  );
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use('/feed', feedRoutes);//http
app.use('/auth', authRoutes);//http

app.use((error,req,res,next)=>{
     console.log(error);
     const status=error.statusCode||500;
     const message=error.message;
     const data=error.data
     res.status(status).json({message:message,data:data});
});

mongoose.connect(MONGODB_URI)
.then(result => {
     const server = app.listen(process.env.PORT || 8080 );
     const io = require('./socket').init(server);
     io.on('connection', socket => {
     });
   })
   .catch(err => console.log(err));
 
