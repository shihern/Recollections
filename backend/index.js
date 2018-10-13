const dotenv = require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({
  storage
});

const minio = require('minio');
const mClient = new minio.Client({
  endPoint : process.env.MINIO_HOST,
  port : +process.env.MINIO_PORT,
  useSSL : false,
  accessKey : process.env.MINIO_ACCESS_KEY,
  secretKey : process.env.MINIO_SECRET_KEY
});

const { Pool } = require('pg');
const db = new Pool({
  host : process.env.PG_HOST,
  port : process.env.PG_PORT,
  database : 'postgres',
  user : process.env.PG_USER,
  password : process.env.PG_PASSWORD
});

const bearerToken = require('bearer-token');
const crypto = require('crypto');
const exifParser = require('exif-parser');
const fileType = require('file-type');
const jwt = require('jsonwebtoken');
const uniqid = require('uniqid');

const insert_file = (userid, file) => {
  return new Promise((resolve, reject) => {
    const putFile = () => {
      const ext = fileType(file).ext;
      const id = `${uniqid()}.${ext}`;
      mClient.putObject(userid, id, file, (put_err, etag) => {
        if(put_err){
          console.log(put_err);
          reject({
            code: 500,
            message: 'Error storing file'
          });
        }else{
          resolve(id);
        }
      });
    };
    mClient.bucketExists(userid, (exists) => {
      if(!exists){ //Create user bucket if it doesn't exist
        mClient.makeBucket(userid, 'ap-southeast-1', (make_err) => {
          if(make_err){
            reject({
              code: 500,
              message: 'Error storing file'
            });
          }else{
            putFile();
          }
        });
      }else{
        putFile();
      }
    });
  });
};

const auth = (req, res, next) => {
  bearerToken(req, (tok_err, token) => { //Get Bearer token from headers
    if(token){
      jwt.verify(token, process.env.SECRET, (ver_err, decoded) => {
        if(ver_err){
          res.status(403).send('Invalid token');
        }else{
          req.user = decoded.email;
          next();
        }
      })
    }else{
      res.status(403).send('Token required');
    }
  });
};

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());

app.get('/', auth, (req, res) => {
  res.status(200).send('Received at backend service.');
});

app.post('/login', (req, res) => {
  if(!req.body.email){
    res.status(400).send('No email provided');
  }else if(!req.body.password){
    res.status(400).send('No password provided');
  }else{
    db.query('SELECT password FROM users WHERE email = $1', [
      req.body.email
    ]).then((db_res) => {
      if(db_res.rows[0] && db_res.rows[0].password === req.body.password) {
        res.status(200).send(jwt.sign({
          email: req.body.email
        }, process.env.SECRET));
      }else{
        res.status(403).send('Invalid credentials');
      }
    }).catch(() => {
      res.status(500).send('Database error');
    });
  }
});

app.post('/signup', upload.single('profile_pic'), (req, res) => {
  if(!req.body.email) {
    res.status(400).send('No email');
  } else if(!req.body.username) {
    res.status(400).send('No username');
  } else if(!req.body.password) {
    res.status(400).send('No email');
  } else if(!req.file) {
    res.status(400).send('No email');
  } else {
    db.query('SELECT 1 FROM users WHERE email = $1', [
      req.body.email
    ]).then((db_res) => {
      if(db_res.rows.length > 0) {
        throw { code: 400, message: "User already exists" };
      } else {
        return insert_file(req.body.email, req.file.buffer);
      }
    }).then((profile_id) => {
      return db.query('INSERT INTO users (email, username, password, profile_pic) VALUES ($1, $2, $3, $4)', [
        req.body.email,
        req.body.username,
        req.body.password,
        profile_id,
      ]);
    }).then(() => {
      res.status(200).send('Success');
    }).catch((err) => {
      if(err.code && err.message) {
        res.status(err.code).send(err.message);
      } else {
        res.status(500).send("Database error");
      }
    });
  }
});

app.post('/images', auth, upload.array('file'), (req, res) => {
  if(!req.files) {
    res.status(400).send('No files');
  } else {
    Promise.all(files.map((file) => {
      return new Promise((resolve, reject) => {
        //TODO: Check fileType for image/jpeg
        let metadata = {};
        try {
          const parser = exifParser.create(file.buffer);
          const results = parser.parse();
          metadata.lat = results.tags.GPSLatitude;
          metadata.lng = results.tags.GPSLongitude;
          metadata.datetime = results.tags.DateTimeOriginal;
        } catch(e) {}
        insert_file(req.user, file.buffer).then((id) => { // Insert file into minio
          //Insert entry into postgres
          return db.query('INSERT INTO images (id, userid, timestamp, lat, lng) VALUES ($1, $2, $3, $4, $5)', [
            id,
            req.user,
            metadata.datetime,
            metadata.lat,
            metadata.lng
          ]);
        }).then(() => {
          resolve({ id, ...metadata, buffer: file.buffer });
        }).catch((err) => reject(err));
      });
    })).then((files_data) => {
      let groups = []; //Group on time
      files_data = files_data.sort((a, b) => a.datetime - b.datetime); //Sort images on date and time
      let differences = [];
      for(let i = 0; i < files_data.length-1; i++){
        differences.push(files_data[i+1].datetime - files_data[i].datetime);
      }
      const difference_sum = differences.reduce((acc, val) => acc + val, 0);
      const difference_mean = difference_sum / differences.length;
      const difference_sd = Math.sqrt(differences.reduce((acc, val) => acc + Math.pow(val - difference_mean, 2), 0.0) / (differences.length - 1));
      let groups = [[files_data[0]]];
      let current_group = 0;
      for(let i = 0; i < differences.length; i++){
        if(differences[i] < 3 * difference_sd) { //3 standard deviations threshold
          groups[current_group].push(files_data[i+1]);
        }else{ //If difference is an outlier
          current_group++;
          groups.push([files_data[i+1]]); //Push into new array entry
        }
      }
      return groups;
    }).then((groups) => {

    });
  }
});

app.listen(process.env.BACKEND_PORT, (err) => {
  err ? console.error(err) : console.log(`Backend listening at ${process.env.BACKEND_PORT}`);
});
