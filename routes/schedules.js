'use strict';
const express = require('express');
const router = express.Router();
const authenticationEnsurer = require('./authentication-ensurer');
const uuid = require('uuid');
const Schedule = require('../models/schedule');
const Candidate = require('../models/candidate');
const User = require('../models/user');
const Availability = require('../models/availability');
const Comment = require('../models/comment');

router.get('/new', authenticationEnsurer, (req, res, next) => {
  res.render('new', { user: req.user });
});

router.post('/', authenticationEnsurer, (req, res, next) => {
  const scheduleId = uuid.v4();   // uuid.v4() で世界で唯一のUUID値を作り出す
  const updatedAt = new Date();
  // 予定をデータベース内に保存しているコード
  Schedule.create({
    scheduleId: scheduleId,
    scheduleName: req.body.scheduleName.slice(0, 255),
    memo: req.body.memo,
    createdBy: req.user.id,
    updatedAt: updatedAt
  }).then((schedule) => {
    createCandidatesAndRedirect(parseCandidateNames(req), scheduleId, res);
  });
});

router.get('/:scheduleId', authenticationEnsurer, (req, res, next) => {
  let storedSchedule = null;
  let storedCandidates = null;
  Schedule.findOne({
    include: [
      {
        model: User,                        // schedule.user というプロパティに、ユーザー情報が設定される
        atributes: ['userId', 'username']   // Where句で絞り込まれた予定情報に関するユーザーIDとユーザー名
      }],
    where: {
      scheduleId: req.params.scheduleId   // パラメータ :scheduleId の値を渡している
    },
    order: [['"updatedAt"', 'DESC']]
  }).then((schedule) => {
    if (schedule) {
      storedSchedule = schedule;
      return Candidate.findAll({
        where: { scheduleId: schedule.scheduleId },
        order: [['"candidateId"', 'ASC']]
      });
    } else {
      const err = new Error('指定された予定は見つかりません');
      err.status = 404;
      next(err);
    }
  }).then((candidates) => {
    // データベースからその予定のすべての出欠を取得する
    storedCandidates = candidates;
    return Availability.findAll({
      include: [
        {
          model: User,
          attributes: ['userId', 'username']
        }
      ],
      where: { scheduleId: storedSchedule.scheduleId },
      order: [[User, '"username"', 'ASC'], ['"candidateId"', 'ASC']]
    });
  }).then((availabilities) => { 
    // 出欠 MapMap(キー:ユーザーID、値:出欠Map(キー：候補ID,　値：出欠)) を作成する         
    // データベース　出欠テーブルに存在する出欠情報（ユーザーID,候補ID,出欠）をマップにセットする
    const availabilityMapMap = new Map(); // key: userId, value: Map(key: candidateId, value: availability)
    availabilities.forEach((a) => {
      const map = availabilityMapMap.get(a.user.userId) || new Map();
      map.set(a.candidateId, a.availability);
      availabilityMapMap.set(a.user.userId, map);
    });

    // 閲覧ユーザーと出欠に紐づくユーザーからユーザー Map（キー：ユーザーID, 値：ユーザー）を作る
    // 出欠のデータを一つでも持っていたユーザーをユーザー、または閲覧ユーザーをユーザーMapに含める
    const userMap = new Map();  // key: userId, value: User
    userMap.set(parseInt(req.user.id), {
      isSelf: true,
      userId: parseInt(req.user.id),
      username: req.user.username
    });
    availabilities.forEach((a) => {
      userMap.set(a.user.userId, {
        isSelf: parseInt(req.user.id) === a.user.userId,  // 閲覧ユーザー自身であるかを含める
        userId: a.user.userId,
        username: a.user.username
      });
    });

    // 全ユーザー、"全候補" で二重ループしてそれぞれの出欠の値がない場合には、「欠席」を設定する
    // 回答していない候補に対する出欠情報を "欠" としてセットする
    const users = Array.from(userMap).map((keyValue) => keyValue[1]);
    users.forEach((u) => {
      storedCandidates.forEach((c) => {
        const map = availabilityMapMap.get(u.userId) || new Map();
        const a = map.get(c.candidateId) || 0;  // デフォルト値は 0 を利用
        map.set(c.candidateId, a);
        availabilityMapMap.set(u.userId, map);
      });
    });

    // コメント取得
    return Comment.findAll({
      where: { scheduleId: storedSchedule.scheduleId }
    }).then((comments) => {
      const commentMap = new Map();  // key: userId, value: comment
      comments.forEach((comment) => {
        commentMap.set(comment.userId, comment.comment);
      });
      res.render('schedule', {
        user: req.user,
        schedule: storedSchedule,
        candidates: storedCandidates,
        users: users,
        availabilityMapMap: availabilityMapMap,
        commentMap: commentMap             
      });
    });
  });
});

router.get('/:scheduleId/edit', authenticationEnsurer, (req, res, next) => {
  Schedule.findOne({
    where: {
      scheduleId: req.params.scheduleId
    }
  }).then((schedule) => {
    if (isMine(req, schedule)) {  // 作成者のみが編集フォームを開ける
      Candidate.findAll({
        where: { scheduleId: schedule.scheduleId },
        order: [['"candidateId"', 'ASC']]
      }).then((candidates) => {
        res.render('edit', {
          user: req.user,
          schedule: schedule,
          candidates: candidates
        });
      });
    } else {
      const err = new Error('指定された予定がない、または、予定する権限がありません');
      err.status = 404;
      next(err);
    }
  });
});

function isMine(req, schedule) {
  return schedule && parseInt(schedule.createdBy) === parseInt(req.user.id);
}

router.post('/:scheduleId', authenticationEnsurer, (req, res, next) => {
  Schedule.findOne({
    where: {
      scheduleId: req.params.scheduleId
    }
  }).then((schedule) => {
    if (schedule && isMine(req, schedule)) {
      if (parseInt(req.query.edit) === 1) {
        const updatedAt = new Date();
        schedule.update({
          scheduleId: schedule.scheduleId,
          scheduleName: req.body.scheduleName.slice(0, 255),
          memo: req.body.memo,
          createdBy: req.user.id,
          updatedAt: updatedAt
        }).then((schedule) => {
          Candidate.findAll({
            where: { scheduleId: schedule.scheduleId },
            order: [['"candidateId"', 'ASC']]
          }).then((candidates) => {
            // 追加されているかチェック
            const candidateNames = parseCandidateNames(req);
            if (candidateNames) {
              createCandidatesAndRedirect(candidateNames, schedule.scheduleId, res);
            } else {
              res.redirect('/schedules/' + schedule.scheduleId);
            }
          });
        });
      } else {
        const err = new Error('不正なリクエストです');
        err.status = 400;
        next(err);
      } 
    } else {
      const err = new Error('指定された予定がない、または、編集する権限がありません');
      err.status = 404;
      next(err);
    }
  });
});

function createCandidatesAndRedirect(candidateNames, scheduleId, res) {
  // 配列のそれぞれの要素からオブジェクトを作成、データベース内での各行のデータとなる
  const candidates = candidateNames.map((c) => {
    return {
      candidateName: c,
      scheduleId: scheduleId
    };
  });
  // bulcCreate でcandidates 配列内のオブジェクトをまとめてデータベースに保存
  Candidate.bulkCreate(candidates).then(() => {
    // データベースに保存後は、いま作成した予定の詳細ページにリダイレクト。/schedules/:scheduleId
    res.redirect('/schedules/' + scheduleId);
  });
}

function parseCandidateNames(req) {
  return req.body.candidates.trim().split('\n').map((s) => s.trim()).filter((s) => s !== "");
}


module.exports = router;