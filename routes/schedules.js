'use strict';
const express = require('express');
const router = express.Router();
const authenticationEnsurer = require('./authentication-ensurer');
const uuid = require('uuid');
const Schedule = require('../models/schedule');
const Candidate = require('../models/candidate');
const User = require('../models/user');

router.get('/new', authenticationEnsurer, (req, res, next) => {
  res.render('new', { user: req.user });
});

router.post('/', authenticationEnsurer, (req, res, next) => {
  const scheduleId = uuid.v4();
  const updatedAt = new Date();
  // 予定をデータベース内に保存しているコード
  Schedule.create({
    scheduleId: scheduleId,
    scheduleName: req.body.scheduleName.slice(0, 255),
    memo: req.body.memo,
    createdBy: req.user.id,
    updatedAt: updatedAt
  }).then((schedule) => {
    // candidateNameもSTRING型で255文字までの制約があるので、slice(0, 255) を使って、制限文字数を超えた分をカットする
    const candidateNames = req.body.candidates.trim().split('\n').map((s) => s.trim().slice(0, 255)).filter((s) => s !== "");
    // 配列のそれぞれの要素からオブジェクトを作成、データベース内での各行のデータとなる
    const candidates = candidateNames.map((c) => { return {
      candidateName: c,
      scheduleId: schedule.scheduleId
    };});
    // bulcCreate でcandidates 配列内のオブジェクトをまとめてデータベースに保存
    Candidate.bulkCreate(candidates).then(() => {
      // データベースに保存後は、いま作成した予定の詳細ページにリダイレクト。/schedules/:scheduleId
      res.redirect('/schedules/' + schedule.scheduleId);
    });
  });
});

router.get('/:scheduleId', authenticationEnsurer, (req, res, next) => {
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
      Candidate.findAll({
        where: { scheduleId: schedule.scheduleId },
        order: [['"candidateId"', 'ASC']]
      }).then((candidates) => {
        res.render('schedule', {
          user: req.user,
          schedule: schedule,
          candidates: candidates,
          users: [req.user]
        });
      });
    } else {
      const err = new Error('指定された予定は見つかりません');
      err.status = 404;
      next(err);
    }
  });
});

module.exports = router;